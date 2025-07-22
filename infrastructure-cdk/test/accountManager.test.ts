import { handler } from "../lambda/accountManager";
import { UserAccountsService } from "../lib/utils/billingDatabase";
import { UserAccount } from "../lib/types/billing";
import { Context } from "aws-lambda";

// Mock the database service
jest.mock("../lib/utils/billingDatabase");
const mockUserAccountsService = UserAccountsService as jest.Mocked<
  typeof UserAccountsService
>;

// Mock UUID generation
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));

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

describe("Account Manager Lambda", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
  });

  describe("POST /accounts - Create User Account", () => {
    const validCreateRequest = {
      requestContext: { http: { method: "POST" } },
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({
        email: "test@example.com",
        githubUsername: "testuser",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [50, 80, 100],
        },
        usageLimits: {
          monthlyLimit: 1000,
          alertAt80Percent: true,
          suspendOnExceed: false,
        },
      }),
      pathParameters: {},
      queryStringParameters: {},
    };

    it("should create a new user account successfully", async () => {
      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(null);
      mockUserAccountsService.createUserAccount.mockResolvedValue();

      const result = await handler(
        validCreateRequest as any,
        mockContext,
        mockCallback
      );

      expect((result as any).statusCode).toBe(201);
      expect(JSON.parse((result as any).body)).toMatchObject({
        message: "User account created successfully",
        userId: "test-uuid-1234",
      });
      expect(mockUserAccountsService.createUserAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-uuid-1234",
          email: "test@example.com",
          githubUsername: "testuser",
          status: "active",
        })
      );
    });

    it("should return 409 if user already exists", async () => {
      const existingUser: UserAccount = {
        userId: "existing-user",
        githubUsername: "testuser",
        email: "test@example.com",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [],
        },
        paymentMethods: [],
        usageLimits: { alertAt80Percent: true, suspendOnExceed: false },
        status: "active",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      };

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        existingUser
      );

      const result = await handler(
        validCreateRequest as any,
        mockContext,
        mockCallback
      );

      expect((result as any).statusCode).toBe(409);
      expect(JSON.parse((result as any).body)).toMatchObject({
        error: "User account already exists",
      });
    });

    it("should return 400 for invalid email", async () => {
      const invalidRequest = {
        ...validCreateRequest,
        body: JSON.stringify({
          email: "invalid-email",
          githubUsername: "testuser",
        }),
      };

      const result = await handler(
        invalidRequest as any,
        mockContext,
        mockCallback
      );

      expect((result as any).statusCode).toBe(400);
      expect(JSON.parse((result as any).body)).toHaveProperty("errors");
      expect(JSON.parse((result as any).body).errors).toContain(
        "Valid email is required"
      );
    });
  });

  describe("OPTIONS requests", () => {
    it("should handle CORS preflight requests", async () => {
      const optionsRequest = {
        requestContext: { http: { method: "OPTIONS" } },
        headers: { origin: "http://localhost:3000" },
        pathParameters: {},
        queryStringParameters: {},
      };

      const result = await handler(
        optionsRequest as any,
        mockContext,
        mockCallback
      );

      expect((result as any).statusCode).toBe(200);
      expect((result as any).headers).toMatchObject({
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      });
    });
  });
});
