import { jest } from "@jest/globals";
import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { handler } from "../lambda/paymentMethodManager";

// Mock context
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "test-function",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:test-function",
  memoryLimitInMB: "128",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/test-function",
  logStreamName: "test-stream",
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

// Mock dependencies
const mockUserAccountsService = {
  getUserAccount: jest.fn() as jest.MockedFunction<any>,
  getPaymentMethods: jest.fn() as jest.MockedFunction<any>,
  addPaymentMethod: jest.fn() as jest.MockedFunction<any>,
  deletePaymentMethod: jest.fn() as jest.MockedFunction<any>,
};

const mockStripeService = {
  createOrGetCustomer: jest.fn() as jest.MockedFunction<any>,
  attachPaymentMethodToCustomer: jest.fn() as jest.MockedFunction<any>,
  detachPaymentMethod: jest.fn() as jest.MockedFunction<any>,
};

jest.mock("../lib/utils/billingDatabase", () => ({
  UserAccountsService: mockUserAccountsService,
}));

jest.mock("../lib/utils/stripeService", () => mockStripeService);

describe("PaymentMethodManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockUserAccount = {
    userId: "user123",
    email: "test@example.com",
    githubUsername: "testuser",
    billingPreferences: { currency: "usd" },
    paymentMethods: [],
    usageLimits: {},
    status: "active" as const,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockPaymentMethod = {
    paymentMethodId: "pm123",
    type: "card" as const,
    last4: "4242",
    expiryMonth: 12,
    expiryYear: 2025,
    isDefault: true,
    stripePaymentMethodId: "pm_stripe123",
    createdAt: "2024-01-01T00:00:00Z",
  };

  describe("POST - Add Payment Method", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "POST" },
      } as any,
      pathParameters: {
        userId: "user123",
      },
      body: JSON.stringify({
        stripePaymentMethodId: "pm_stripe123",
        isDefault: true,
      }),
      headers: {},
    };

    it("should add payment method successfully", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockStripeService.createOrGetCustomer.mockResolvedValue({
        id: "cus_123",
      });
      mockStripeService.attachPaymentMethodToCustomer.mockResolvedValue({
        id: "pm_stripe123",
        type: "card",
        card: {
          last4: "4242",
          exp_month: 12,
          exp_year: 2025,
        },
      });
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([]);

      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment method added successfully",
        paymentMethodId: expect.any(String),
      });
      expect(mockUserAccountsService.addPaymentMethod).toHaveBeenCalled();
    });

    it("should return 404 if user not found", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(null);

      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "User account not found",
      });
    });
  });

  describe("GET - Get Payment Methods", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "GET" },
      } as any,
      pathParameters: {
        userId: "user123",
      },
      headers: {},
    };

    it("should get payment methods successfully", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([
        mockPaymentMethod,
      ]);

      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.paymentMethods).toHaveLength(1);
      expect(responseBody.paymentMethods[0]).toMatchObject({
        paymentMethodId: "pm123",
        type: "card",
        last4: "4242",
        isDefault: true,
      });
      // Should not expose Stripe payment method ID
      expect(
        responseBody.paymentMethods[0].stripePaymentMethodId
      ).toBeUndefined();
    });

    it("should return 404 if user not found", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(null);

      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "User account not found",
      });
    });
  });

  describe("DELETE - Remove Payment Method", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "DELETE" },
      } as any,
      pathParameters: {
        userId: "user123",
        paymentMethodId: "pm123",
      },
      headers: {},
    };

    it("should remove payment method successfully", async () => {
      const otherPaymentMethod = {
        ...mockPaymentMethod,
        paymentMethodId: "pm456",
        isDefault: false,
      };

      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([
        mockPaymentMethod,
        otherPaymentMethod,
      ]);

      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment method removed successfully",
      });
      expect(mockStripeService.detachPaymentMethod).toHaveBeenCalledWith(
        "pm_stripe123"
      );
      expect(mockUserAccountsService.deletePaymentMethod).toHaveBeenCalledWith(
        "user123",
        "pm123"
      );
    });

    it("should return 400 if trying to remove the only payment method", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([
        mockPaymentMethod,
      ]);

      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error:
          "Cannot remove the only payment method. Add another payment method first.",
      });
    });
  });

  describe("OPTIONS - CORS", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "OPTIONS" },
      } as any,
      pathParameters: {
        userId: "user123",
      },
      headers: {},
    };

    it("should handle OPTIONS request", async () => {
      const result = await handler(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe("");
      expect(result.headers).toMatchObject({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      });
    });
  });

  describe("Error Handling", () => {
    it("should return 400 if user ID is missing", async () => {
      const eventWithoutUserId: Partial<APIGatewayProxyEventV2> = {
        requestContext: {
          http: { method: "GET" },
        } as any,
        pathParameters: {},
        headers: {},
      };

      const result = await handler(
        eventWithoutUserId as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "User ID is required",
      });
    });

    it("should return 405 for unsupported methods", async () => {
      const eventWithUnsupportedMethod: Partial<APIGatewayProxyEventV2> = {
        requestContext: {
          http: { method: "PATCH" },
        } as any,
        pathParameters: {
          userId: "user123",
        },
        headers: {},
      };

      const result = await handler(
        eventWithUnsupportedMethod as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(405);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Method not allowed",
      });
    });
  });
});
