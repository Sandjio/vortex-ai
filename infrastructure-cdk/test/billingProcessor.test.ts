import { handler, manualBillingHandler } from "../lambda/billingProcessor";
import { calculateBillingForUsage } from "../lambda/pricingManager";
import {
  UsageRecordsService,
  UserAccountsService,
  InvoicesService,
  PricingConfigService,
} from "../lib/utils/billingDatabase";
import {
  PricingTier,
  UserAccount,
  UsageRecordItem,
  Invoice,
} from "../lib/types/billing";
import { ScheduledEvent, Context } from "aws-lambda";

// Mock AWS SDK
jest.mock("@aws-sdk/client-dynamodb");
jest.mock("@aws-sdk/lib-dynamodb");

// Mock the database services
jest.mock("../lib/utils/billingDatabase");
jest.mock("../lambda/pricingManager");

const mockUsageRecordsService = UsageRecordsService as jest.Mocked<
  typeof UsageRecordsService
>;
const mockUserAccountsService = UserAccountsService as jest.Mocked<
  typeof UserAccountsService
>;
const mockInvoicesService = InvoicesService as jest.Mocked<
  typeof InvoicesService
>;
const mockPricingConfigService = PricingConfigService as jest.Mocked<
  typeof PricingConfigService
>;
const mockCalculateBillingForUsage =
  calculateBillingForUsage as jest.MockedFunction<
    typeof calculateBillingForUsage
  >;

describe("Billing Processor", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default environment
    process.env.TABLE_NAME = "test-billing-table";
  });

  describe("Scheduled Billing Handler", () => {
    const mockScheduledEvent: ScheduledEvent = {
      version: "0",
      id: "test-event-id",
      "detail-type": "Scheduled Event",
      source: "aws.events",
      account: "123456789012",
      time: "2024-02-01T00:00:00Z",
      region: "us-east-1",
      detail: {},
      resources: [
        "arn:aws:events:us-east-1:123456789012:rule/billing-schedule",
      ],
    };

    const mockContext: Context = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: "billing-processor",
      functionVersion: "$LATEST",
      invokedFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:billing-processor",
      memoryLimitInMB: "128",
      awsRequestId: "test-request-id",
      logGroupName: "/aws/lambda/billing-processor",
      logStreamName: "2024/02/01/[$LATEST]test-stream",
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    };

    it("should process billing for all users with usage", async () => {
      // Mock usage records for multiple users
      const mockUsageRecords: UsageRecordItem[] = [
        {
          PK: "USER#user1",
          SK: "2024-01-15T10:00:00Z#event1",
          eventType: "commit",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-15T10:00:00Z",
          githubUsername: "user1",
        },
        {
          PK: "USER#user1",
          SK: "2024-01-16T10:00:00Z#event2",
          eventType: "pull_request",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-16T10:00:00Z",
          githubUsername: "user1",
        },
        {
          PK: "USER#user2",
          SK: "2024-01-17T10:00:00Z#event3",
          eventType: "commit",
          repository: "repo2",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-17T10:00:00Z",
          githubUsername: "user2",
        },
      ];

      const mockUserAccount: UserAccount = {
        userId: "user1",
        githubUsername: "user1",
        email: "user1@example.com",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80],
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

      const mockBillingCalculation = {
        userId: "user1",
        billingPeriod: "2024-01",
        usageCount: 2,
        baseRate: 0.1,
        discountTier: "Basic",
        totalAmount: 0.2,
        breakdown: [
          {
            tier: "Basic",
            eventCount: 2,
            rate: 0.1,
            amount: 0.2,
          },
        ],
      };

      // Set up mocks
      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(null); // No existing invoice
      mockCalculateBillingForUsage.mockResolvedValue(mockBillingCalculation);
      mockInvoicesService.createInvoice.mockResolvedValue();

      await handler(mockScheduledEvent, mockContext);

      // Verify the correct billing period was used (previous month)
      expect(mockUsageRecordsService.getAllUsageForPeriod).toHaveBeenCalledWith(
        "2025-06"
      );

      // Verify user account was checked
      expect(mockUserAccountsService.getUserAccount).toHaveBeenCalledWith(
        "user1"
      );
      expect(mockUserAccountsService.getUserAccount).toHaveBeenCalledWith(
        "user2"
      );

      // Verify billing calculation was performed
      expect(mockCalculateBillingForUsage).toHaveBeenCalledWith(
        "user1",
        "2025-06",
        2
      );
      expect(mockCalculateBillingForUsage).toHaveBeenCalledWith(
        "user2",
        "2025-06",
        1
      );

      // Verify invoice was created
      expect(mockInvoicesService.createInvoice).toHaveBeenCalled();
    });

    it("should skip billing for inactive users", async () => {
      const mockUsageRecords: UsageRecordItem[] = [
        {
          PK: "USER#suspended-user",
          SK: "2024-01-15T10:00:00Z#event1",
          eventType: "commit",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-15T10:00:00Z",
          githubUsername: "suspended-user",
        },
      ];

      const mockSuspendedUser: UserAccount = {
        userId: "suspended-user",
        githubUsername: "suspended-user",
        email: "suspended@example.com",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80],
        },
        paymentMethods: [],
        usageLimits: {
          monthlyLimit: 1000,
          alertAt80Percent: true,
          suspendOnExceed: false,
        },
        status: "suspended",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );
      mockUserAccountsService.getUserAccount.mockResolvedValue(
        mockSuspendedUser
      );

      await handler(mockScheduledEvent, mockContext);

      // Verify billing calculation was not performed for suspended user
      expect(mockCalculateBillingForUsage).not.toHaveBeenCalled();
      expect(mockInvoicesService.createInvoice).not.toHaveBeenCalled();
    });

    it("should skip billing if invoice already exists", async () => {
      const mockUsageRecords: UsageRecordItem[] = [
        {
          PK: "USER#user1",
          SK: "2024-01-15T10:00:00Z#event1",
          eventType: "commit",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-15T10:00:00Z",
          githubUsername: "user1",
        },
      ];

      const mockExistingInvoice: Invoice = {
        invoiceId: "INV-user1-2024-01-123456789",
        userId: "user1",
        billingPeriod: "2024-01",
        issueDate: "2024-02-01T00:00:00Z",
        dueDate: "2024-03-01T00:00:00Z",
        totalAmount: 0.1,
        status: "pending",
        lineItems: [],
        paymentAttempts: [],
      };

      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );
      mockInvoicesService.getInvoice.mockResolvedValue(mockExistingInvoice);

      await handler(mockScheduledEvent, mockContext);

      // Verify no new invoice was created
      expect(mockInvoicesService.createInvoice).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully and continue processing other users", async () => {
      const mockUsageRecords: UsageRecordItem[] = [
        {
          PK: "USER#user1",
          SK: "2024-01-15T10:00:00Z#event1",
          eventType: "commit",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-15T10:00:00Z",
          githubUsername: "user1",
        },
        {
          PK: "USER#user2",
          SK: "2024-01-16T10:00:00Z#event2",
          eventType: "commit",
          repository: "repo2",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-16T10:00:00Z",
          githubUsername: "user2",
        },
      ];

      const mockUserAccount: UserAccount = {
        userId: "user2",
        githubUsername: "user2",
        email: "user2@example.com",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80],
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

      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );
      mockUserAccountsService.getUserAccount
        .mockRejectedValueOnce(new Error("Database error for user1"))
        .mockResolvedValueOnce(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(null);
      mockCalculateBillingForUsage.mockResolvedValue({
        userId: "user2",
        billingPeriod: "2024-01",
        usageCount: 1,
        baseRate: 0.1,
        discountTier: "Basic",
        totalAmount: 0.1,
        breakdown: [
          {
            tier: "Basic",
            eventCount: 1,
            rate: 0.1,
            amount: 0.1,
          },
        ],
      });
      mockInvoicesService.createInvoice.mockResolvedValue();

      // Should not throw error, but continue processing
      await expect(
        handler(mockScheduledEvent, mockContext)
      ).resolves.not.toThrow();

      // Verify user2 was still processed despite user1 error
      expect(mockCalculateBillingForUsage).toHaveBeenCalledWith(
        "user2",
        "2025-06",
        1
      );
      expect(mockInvoicesService.createInvoice).toHaveBeenCalled();
    });

    it("should handle zero usage correctly", async () => {
      const mockUsageRecords: UsageRecordItem[] = [];

      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );

      await handler(mockScheduledEvent, mockContext);

      // Verify no billing processing occurred
      expect(mockUserAccountsService.getUserAccount).not.toHaveBeenCalled();
      expect(mockCalculateBillingForUsage).not.toHaveBeenCalled();
      expect(mockInvoicesService.createInvoice).not.toHaveBeenCalled();
    });
  });

  describe("Manual Billing Handler", () => {
    it("should process billing for a specific user and period", async () => {
      const mockUsageRecords: UsageRecordItem[] = [
        {
          PK: "USER#user1",
          SK: "2024-01-15T10:00:00Z#event1",
          eventType: "commit",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-15T10:00:00Z",
          githubUsername: "user1",
        },
      ];

      const mockUserAccount: UserAccount = {
        userId: "user1",
        githubUsername: "user1",
        email: "user1@example.com",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80],
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

      mockUsageRecordsService.getUserUsage.mockResolvedValue(mockUsageRecords);
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockInvoicesService.getInvoice.mockResolvedValue(null);
      mockCalculateBillingForUsage.mockResolvedValue({
        userId: "user1",
        billingPeriod: "2024-01",
        usageCount: 1,
        baseRate: 0.1,
        discountTier: "Basic",
        totalAmount: 0.1,
        breakdown: [
          {
            tier: "Basic",
            eventCount: 1,
            rate: 0.1,
            amount: 0.1,
          },
        ],
      });
      mockInvoicesService.createInvoice.mockResolvedValue();

      await manualBillingHandler({
        billingPeriod: "2024-01",
        userId: "user1",
      });

      expect(mockUsageRecordsService.getUserUsage).toHaveBeenCalledWith(
        "user1",
        "2024-01"
      );
      expect(mockCalculateBillingForUsage).toHaveBeenCalledWith(
        "user1",
        "2024-01",
        1
      );
      expect(mockInvoicesService.createInvoice).toHaveBeenCalled();
    });

    it("should process billing for all users when no specific user provided", async () => {
      const mockUsageRecords: UsageRecordItem[] = [
        {
          PK: "USER#user1",
          SK: "2024-01-15T10:00:00Z#event1",
          eventType: "commit",
          repository: "repo1",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-15T10:00:00Z",
          githubUsername: "user1",
        },
      ];

      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );
      mockUserAccountsService.getUserAccount.mockResolvedValue({
        userId: "user1",
        githubUsername: "user1",
        email: "user1@example.com",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80],
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
      });
      mockInvoicesService.getInvoice.mockResolvedValue(null);
      mockCalculateBillingForUsage.mockResolvedValue({
        userId: "user1",
        billingPeriod: "2024-01",
        usageCount: 1,
        baseRate: 0.1,
        discountTier: "Basic",
        totalAmount: 0.1,
        breakdown: [
          {
            tier: "Basic",
            eventCount: 1,
            rate: 0.1,
            amount: 0.1,
          },
        ],
      });
      mockInvoicesService.createInvoice.mockResolvedValue();

      await manualBillingHandler({
        billingPeriod: "2024-01",
      });

      expect(mockUsageRecordsService.getAllUsageForPeriod).toHaveBeenCalledWith(
        "2024-01"
      );
      expect(mockCalculateBillingForUsage).toHaveBeenCalledWith(
        "user1",
        "2024-01",
        1
      );
    });

    it("should use previous month as default billing period", async () => {
      const mockUsageRecords: UsageRecordItem[] = [];

      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue(
        mockUsageRecords
      );

      await manualBillingHandler({});

      // Should call with previous month (current month is July 2025, so previous is June 2025)
      expect(mockUsageRecordsService.getAllUsageForPeriod).toHaveBeenCalledWith(
        "2025-06"
      );
    });
  });
});
