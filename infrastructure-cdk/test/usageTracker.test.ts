import { handler } from "../lambda/usageTracker";
import {
  UsageRecordsService,
  UserAccountsService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { EventBridgeEvent } from "aws-lambda";
import { UserAccount } from "../lib/types/billing";

// Mock the database services
jest.mock("../lib/utils/billingDatabase");
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-user-id-123"),
}));

const mockUsageRecordsService = UsageRecordsService as jest.Mocked<
  typeof UsageRecordsService
>;
const mockUserAccountsService = UserAccountsService as jest.Mocked<
  typeof UserAccountsService
>;
const mockBillingUtils = BillingUtils as jest.Mocked<typeof BillingUtils>;

describe("Usage Tracker Lambda", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock BillingUtils.getCurrentBillingPeriod
    mockBillingUtils.getCurrentBillingPeriod.mockReturnValue("2024-01");
  });

  const createMockEvent = (
    overrides: any = {}
  ): EventBridgeEvent<"bedrock.response", any> => ({
    version: "0",
    id: "test-event-id",
    "detail-type": "bedrock.response",
    source: "vortex.github",
    account: "123456789012",
    time: "2024-01-15T10:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: {
      analysisResult: { content: [{ text: "Analysis complete" }] },
      eventId: "original-event-123",
      repo: "test-org/test-repo",
      type: "commit",
      fileCount: 3,
      githubUsername: "testuser",
      ...overrides,
    },
  });

  const createMockUserAccount = (overrides: any = {}): UserAccount => ({
    userId: "test-user-id-123",
    githubUsername: "testuser",
    email: "testuser@example.com",
    billingPreferences: {
      frequency: "monthly",
      currency: "USD",
      alertThresholds: [80, 95],
    },
    paymentMethods: [],
    usageLimits: {
      monthlyLimit: 1000,
      alertAt80Percent: true,
      suspendOnExceed: true,
    },
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });

  describe("Successful usage tracking", () => {
    it("should track usage for existing active user", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Usage tracked successfully");

      expect(
        mockUserAccountsService.getUserAccountByGitHub
      ).toHaveBeenCalledWith("testuser");
      expect(mockUsageRecordsService.recordUsage).toHaveBeenCalledWith({
        userId: "test-user-id-123",
        githubUsername: "testuser",
        eventType: "commit",
        eventId: "original-event-123",
        repository: "test-org/test-repo",
        timestamp: expect.any(String),
        analysisSuccess: true,
        billingPeriod: "2024-01",
        eventMetadata: {
          fileCount: 3,
          originalEventId: "test-event-id",
          analysisTimestamp: expect.any(String),
        },
      });
    });

    it("should create new user account if not exists", async () => {
      const mockEvent = createMockEvent();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(null);
      mockUserAccountsService.createUserAccount.mockResolvedValue();
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(1);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Usage tracked successfully");

      expect(mockUserAccountsService.createUserAccount).toHaveBeenCalledWith({
        userId: "test-user-id-123",
        githubUsername: "testuser",
        email: "testuser@github.local",
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80, 95],
        },
        paymentMethods: [],
        usageLimits: {
          monthlyLimit: 1000,
          alertAt80Percent: true,
          suspendOnExceed: true,
        },
        status: "active",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("should handle pull_request event type correctly", async () => {
      const mockEvent = createMockEvent({ type: "pull_request" });
      const mockUser = createMockUserAccount();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockUsageRecordsService.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "pull_request",
        })
      );
    });
  });

  describe("Usage limits and alerts", () => {
    it("should suspend user when usage limit exceeded", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount({
        usageLimits: {
          monthlyLimit: 100,
          alertAt80Percent: true,
          suspendOnExceed: true,
        },
      });

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(100); // At limit
      mockUserAccountsService.updateUserAccount.mockResolvedValue();

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockUserAccountsService.updateUserAccount).toHaveBeenCalledWith(
        "test-user-id-123",
        { status: "suspended" }
      );
    });

    it("should not suspend user when suspendOnExceed is false", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount({
        usageLimits: {
          monthlyLimit: 100,
          alertAt80Percent: true,
          suspendOnExceed: false,
        },
      });

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(100);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockUserAccountsService.updateUserAccount).not.toHaveBeenCalled();
    });

    it("should handle users without usage limits", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount({
        usageLimits: {
          alertAt80Percent: false,
          suspendOnExceed: false,
        },
      });

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(mockUsageRecordsService.getUserUsageCount).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should skip tracking for inactive users", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount({ status: "suspended" });

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("User account not active");
      expect(mockUsageRecordsService.recordUsage).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      const mockEvent = createMockEvent();

      mockUserAccountsService.getUserAccountByGitHub.mockRejectedValue(
        new Error("Database connection failed")
      );

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("Usage tracking failed");
    });

    it("should handle duplicate usage events with idempotency", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockRejectedValue(
        new Error("ConditionalCheckFailedException") // DynamoDB duplicate prevention
      );

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("Usage tracking failed");
    });

    it("should handle usage limit check errors gracefully", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockRejectedValue(
        new Error("Failed to get usage count")
      );

      const result = await handler(mockEvent);

      // Should still succeed even if usage limit check fails
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Usage tracked successfully");
    });
  });

  describe("Idempotency", () => {
    it("should use original event ID for idempotency", async () => {
      const mockEvent = createMockEvent({
        eventId: "unique-original-event-456",
      });
      const mockUser = createMockUserAccount();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      await handler(mockEvent);

      expect(mockUsageRecordsService.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "unique-original-event-456",
        })
      );
    });

    it("should include metadata for audit purposes", async () => {
      const mockEvent = createMockEvent({
        fileCount: 5,
      });
      const mockUser = createMockUserAccount();

      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      await handler(mockEvent);

      expect(mockUsageRecordsService.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          eventMetadata: {
            fileCount: 5,
            originalEventId: "test-event-id",
            analysisTimestamp: expect.any(String),
          },
        })
      );
    });
  });

  describe("Billing period handling", () => {
    it("should use current billing period", async () => {
      const mockEvent = createMockEvent();
      const mockUser = createMockUserAccount();

      mockBillingUtils.getCurrentBillingPeriod.mockReturnValue("2024-02");
      mockUserAccountsService.getUserAccountByGitHub.mockResolvedValue(
        mockUser
      );
      mockUsageRecordsService.recordUsage.mockResolvedValue();
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      await handler(mockEvent);

      expect(mockUsageRecordsService.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          billingPeriod: "2024-02",
        })
      );
    });
  });
});
