import { handler } from "../lambda/billingApi";
import {
  Context,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  UsageRecordsService,
  UserAccountsService,
  InvoicesService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { UserAccount, Invoice, UsageRecordItem } from "../lib/types/billing";

// Mock the database services
jest.mock("../lib/utils/billingDatabase");

const mockUsageRecordsService = UsageRecordsService as jest.Mocked<
  typeof UsageRecordsService
>;
const mockUserAccountsService = UserAccountsService as jest.Mocked<
  typeof UserAccountsService
>;
const mockInvoicesService = InvoicesService as jest.Mocked<
  typeof InvoicesService
>;
const mockBillingUtils = BillingUtils as jest.Mocked<typeof BillingUtils>;

// Mock Lambda context
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "test-function",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:test-function",
  memoryLimitInMB: "256",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/test-function",
  logStreamName: "test-stream",
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

// Mock callback
const mockCallback = jest.fn();

describe("Billing API Handler", () => {
  const mockUserId = "test-user-123";
  const mockToken = Buffer.from(
    JSON.stringify({ userId: mockUserId })
  ).toString("base64");

  const mockUserAccount: UserAccount = {
    userId: mockUserId,
    githubUsername: "testuser",
    email: "test@example.com",
    billingPreferences: {
      frequency: "monthly",
      currency: "USD",
      alertThresholds: [50, 80, 100],
    },
    paymentMethods: [],
    usageLimits: {
      monthlyLimit: 1000,
      alertAt80Percent: true,
      suspendOnExceed: false,
    },
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
    mockBillingUtils.getCurrentBillingPeriod.mockReturnValue("2024-01");
  });

  describe("Authentication and Authorization", () => {
    it("should return 401 for missing authorization header", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: { origin: "http://localhost:3000" },
        pathParameters: {},
        queryStringParameters: {},
      };

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(401);
      expect(JSON.parse((response as any).body)).toEqual({
        error: "Unauthorized",
      });
    });

    it("should return 401 for invalid token format", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: "Bearer invalid-token",
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(401);
      expect(JSON.parse((response as any).body)).toEqual({
        error: "Unauthorized",
      });
    });

    it("should return 404 for non-existent user", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(null);

      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(404);
      expect(JSON.parse((response as any).body)).toEqual({
        error: "User account not found",
      });
    });
  });

  describe("CORS Handling", () => {
    it("should handle OPTIONS requests correctly", async () => {
      const event = {
        requestContext: {
          http: { method: "OPTIONS", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: { origin: "http://localhost:3000" },
        pathParameters: {},
        queryStringParameters: {},
      };

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(200);
      expect(
        (response as any).headers["Access-Control-Allow-Origin"]
      ).toBeDefined();
      expect(
        (response as any).headers["Access-Control-Allow-Methods"]
      ).toBeDefined();
      expect(
        (response as any).headers["Access-Control-Allow-Headers"]
      ).toBeDefined();
      expect((response as any).body).toBe("");
    });
  });

  describe("Usage History Endpoint", () => {
    const mockUsageRecords: UsageRecordItem[] = [
      {
        PK: `USER#${mockUserId}`,
        SK: "2024-01-15T10:00:00Z#event-1",
        eventType: "commit",
        repository: "test/repo",
        billingPeriod: "2024-01",
        analysisSuccess: true,
        createdAt: "2024-01-15T10:00:00Z",
        githubUsername: "testuser",
      },
      {
        PK: `USER#${mockUserId}`,
        SK: "2024-01-14T09:00:00Z#event-2",
        eventType: "pull_request",
        repository: "test/repo",
        billingPeriod: "2024-01",
        analysisSuccess: true,
        createdAt: "2024-01-14T09:00:00Z",
        githubUsername: "testuser",
      },
    ];

    it("should return usage history successfully", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      mockUsageRecordsService.getUserUsage.mockResolvedValue(mockUsageRecords);

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(200);
      const body = JSON.parse((response as any).body);
      expect(body.usageHistory).toHaveLength(2);
      expect(body.usageHistory[0]).toEqual({
        eventId: "event-1",
        eventType: "commit",
        repository: "test/repo",
        timestamp: "2024-01-15T10:00:00Z",
        billingPeriod: "2024-01",
        analysisSuccess: true,
      });
      expect(body.pagination.total).toBe(2);
      expect(body.summary.totalEvents).toBe(2);
      expect(body.summary.successfulEvents).toBe(2);
    });

    it("should validate query parameters", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {
          billingPeriod: "invalid-format",
          limit: "invalid",
        },
      };

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(400);
      const body = JSON.parse((response as any).body);
      expect(body.errors).toContain("billingPeriod must be in YYYY-MM format");
      expect(body.errors).toContain(
        "limit must be a number between 1 and 1000"
      );
    });
  });

  describe("Current Usage Endpoint", () => {
    it("should return current usage successfully", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/current-usage" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(750);

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(200);
      const body = JSON.parse((response as any).body);
      expect(body.usageCount).toBe(750);
      expect(body.usageLimit).toBe(1000);
      expect(body.usagePercentage).toBe(75);
      expect(body.isNearLimit).toBe(false);
      expect(body.isOverLimit).toBe(false);
    });
  });

  describe("Invoices List Endpoint", () => {
    const mockInvoices: Invoice[] = [
      {
        invoiceId: "INV-001",
        userId: mockUserId,
        billingPeriod: "2024-01",
        issueDate: "2024-02-01T00:00:00Z",
        dueDate: "2024-03-01T00:00:00Z",
        totalAmount: 25.5,
        status: "paid",
        paidDate: "2024-02-15T00:00:00Z",
        lineItems: [
          {
            description: "Usage charges",
            quantity: 510,
            unitPrice: 0.05,
            amount: 25.5,
            period: "2024-01",
          },
        ],
        paymentAttempts: [],
      },
    ];

    it("should return invoices list successfully", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/invoices" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      mockInvoicesService.getUserInvoices.mockResolvedValue(mockInvoices);

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(200);
      const body = JSON.parse((response as any).body);
      expect(body.invoices).toHaveLength(1);
      expect(body.invoices[0].invoiceId).toBe("INV-001");
      expect(body.summary.total).toBe(1);
      expect(body.summary.paid).toBe(1);
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/usage-history" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      mockUsageRecordsService.getUserUsage.mockRejectedValue(
        new Error("Database error")
      );

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(500);
      expect(JSON.parse((response as any).body)).toEqual({
        error: "Failed to retrieve usage history",
      });
    });

    it("should return 404 for unknown endpoints", async () => {
      const event = {
        requestContext: {
          http: { method: "GET", path: "/billing/unknown-endpoint" },
          identity: { sourceIp: "127.0.0.1" },
        },
        headers: {
          authorization: `Bearer ${mockToken}`,
          origin: "http://localhost:3000",
        },
        pathParameters: {},
        queryStringParameters: {},
      };

      const response = await handler(event as any, mockContext, mockCallback);

      expect(response).toBeDefined();
      expect((response as any).statusCode).toBe(404);
      expect(JSON.parse((response as any).body)).toEqual({
        error: "Endpoint not found",
      });
    });
  });
});
