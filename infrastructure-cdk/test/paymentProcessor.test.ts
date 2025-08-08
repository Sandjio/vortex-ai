import { jest } from "@jest/globals";
import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import {
  processInvoicePayment,
  confirmPayment,
  getPaymentStatus,
} from "../lambda/paymentProcessor";

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
};

const mockInvoicesService = {
  getInvoice: jest.fn() as jest.MockedFunction<any>,
  createInvoice: jest.fn() as jest.MockedFunction<any>,
  updateInvoiceStatus: jest.fn() as jest.MockedFunction<any>,
  getUserInvoices: jest.fn() as jest.MockedFunction<any>,
};

const mockStripeService = {
  createOrGetCustomer: jest.fn() as jest.MockedFunction<any>,
  createPaymentIntent: jest.fn() as jest.MockedFunction<any>,
  confirmPaymentIntent: jest.fn() as jest.MockedFunction<any>,
};

jest.mock("../lib/utils/billingDatabase", () => ({
  UserAccountsService: mockUserAccountsService,
  InvoicesService: mockInvoicesService,
}));

jest.mock("../lib/utils/stripeService", () => mockStripeService);

describe("PaymentProcessor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("processInvoicePayment", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "POST" },
      } as any,
      pathParameters: {
        userId: "user123",
        billingPeriod: "2024-01",
      },
      body: JSON.stringify({
        paymentMethodId: "pm123",
      }),
      headers: {},
    };

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

    const mockInvoice = {
      invoiceId: "inv123",
      userId: "user123",
      billingPeriod: "2024-01",
      issueDate: "2024-01-01T00:00:00Z",
      dueDate: "2024-01-31T00:00:00Z",
      totalAmount: 25.5,
      status: "pending" as const,
      lineItems: [],
      paymentAttempts: [],
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

    it("should process payment successfully", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(mockInvoice);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([
        mockPaymentMethod,
      ]);
      mockStripeService.createOrGetCustomer.mockResolvedValue({
        id: "cus_123",
      });
      mockStripeService.createPaymentIntent.mockResolvedValue({
        id: "pi_123",
        status: "succeeded",
      });

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment processed successfully",
        status: "succeeded",
        paymentIntentId: "pi_123",
      });

      expect(mockStripeService.createPaymentIntent).toHaveBeenCalledWith(
        25.5,
        "usd",
        "cus_123",
        "pm_stripe123",
        "inv123"
      );
    });

    it("should handle payment requiring action", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(mockInvoice);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([
        mockPaymentMethod,
      ]);
      mockStripeService.createOrGetCustomer.mockResolvedValue({
        id: "cus_123",
      });
      mockStripeService.createPaymentIntent.mockResolvedValue({
        id: "pi_123",
        status: "requires_action",
        client_secret: "pi_123_secret",
      });

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment requires additional action",
        status: "requires_action",
        paymentIntentId: "pi_123",
        clientSecret: "pi_123_secret",
      });
    });

    it("should handle payment failure", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(mockInvoice);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([
        mockPaymentMethod,
      ]);
      mockStripeService.createOrGetCustomer.mockResolvedValue({
        id: "cus_123",
      });
      mockStripeService.createPaymentIntent.mockResolvedValue({
        id: "pi_123",
        status: "requires_payment_method",
        last_payment_error: { message: "Card declined" },
      });

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment failed",
        status: "requires_payment_method",
        error: "Card declined",
      });
    });

    it("should return 404 if user not found", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(null);

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "User account not found",
      });
    });

    it("should return 404 if invoice not found", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(null);

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Invoice not found",
      });
    });

    it("should return 400 if invoice already paid", async () => {
      const paidInvoice = { ...mockInvoice, status: "paid" as const };
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(paidInvoice);

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Invoice is already paid",
      });
    });

    it("should return 404 if payment method not found", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(mockInvoice);
      mockUserAccountsService.getPaymentMethods.mockResolvedValue([]);

      const result = await processInvoicePayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Payment method not found",
      });
    });

    it("should return 400 if payment method ID missing", async () => {
      const eventWithoutPaymentMethod = {
        ...mockEvent,
        body: JSON.stringify({}),
      };

      const result = await processInvoicePayment(
        eventWithoutPaymentMethod as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Payment method ID is required",
      });
    });

    it("should handle OPTIONS request", async () => {
      const optionsEvent = {
        ...mockEvent,
        requestContext: {
          http: { method: "OPTIONS" },
        } as any,
      };

      const result = await processInvoicePayment(
        optionsEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe("");
    });
  });

  describe("confirmPayment", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "POST" },
      } as any,
      body: JSON.stringify({
        paymentIntentId: "pi_123",
      }),
      headers: {},
    };

    it("should confirm payment successfully", async () => {
      mockStripeService.confirmPaymentIntent.mockResolvedValue({
        id: "pi_123",
        status: "succeeded",
        metadata: {
          invoiceId: "inv123",
          userId: "user123",
        },
      });

      mockInvoicesService.getUserInvoices.mockResolvedValue([
        {
          invoiceId: "inv123",
          billingPeriod: "2024-01",
          paymentAttempts: [],
        },
      ]);

      const result = await confirmPayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment confirmed successfully",
        status: "succeeded",
      });
    });

    it("should handle confirmation failure", async () => {
      mockStripeService.confirmPaymentIntent.mockResolvedValue({
        id: "pi_123",
        status: "requires_payment_method",
        last_payment_error: { message: "Card declined" },
      });

      const result = await confirmPayment(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        message: "Payment confirmation failed",
        status: "requires_payment_method",
        error: "Card declined",
      });
    });

    it("should return 400 if payment intent ID missing", async () => {
      const eventWithoutPaymentIntent = {
        ...mockEvent,
        body: JSON.stringify({}),
      };

      const result = await confirmPayment(
        eventWithoutPaymentIntent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Payment intent ID is required",
      });
    });
  });

  describe("getPaymentStatus", () => {
    const mockEvent: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: { method: "GET" },
      } as any,
      pathParameters: {
        userId: "user123",
        billingPeriod: "2024-01",
      },
      headers: {},
    };

    const mockInvoice = {
      invoiceId: "inv123",
      userId: "user123",
      billingPeriod: "2024-01",
      status: "paid" as const,
      totalAmount: 25.5,
      paidDate: "2024-01-15T00:00:00Z",
      paymentAttempts: [
        {
          attemptId: "attempt123",
          timestamp: "2024-01-15T00:00:00Z",
          amount: 25.5,
          status: "succeeded" as const,
        },
      ],
    };

    it("should return payment status successfully", async () => {
      mockInvoicesService.getInvoice.mockResolvedValue(mockInvoice);

      const result = await getPaymentStatus(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        invoiceId: "inv123",
        status: "paid",
        totalAmount: 25.5,
        paidDate: "2024-01-15T00:00:00Z",
        paymentAttempts: [
          {
            attemptId: "attempt123",
            timestamp: "2024-01-15T00:00:00Z",
            amount: 25.5,
            status: "succeeded",
          },
        ],
      });
    });

    it("should return 404 if invoice not found", async () => {
      mockInvoicesService.getInvoice.mockResolvedValue(null);

      const result = await getPaymentStatus(
        mockEvent as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "Invoice not found",
      });
    });

    it("should return 400 if parameters missing", async () => {
      const eventWithoutParams = {
        ...mockEvent,
        pathParameters: {},
      };

      const result = await getPaymentStatus(
        eventWithoutParams as APIGatewayProxyEventV2,
        mockContext
      );

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: "User ID and billing period are required",
      });
    });
  });
});
