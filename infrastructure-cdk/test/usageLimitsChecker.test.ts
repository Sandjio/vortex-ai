import {
  handler,
  checkUserUsageLimits,
  triggerUsageLimitCheck,
} from "../lambda/usageLimitsChecker";
import {
  UserAccountsService,
  UsageRecordsService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { UserAccount } from "../lib/types/billing";

// Mock dependencies
jest.mock("../lib/utils/billingDatabase");
jest.mock("../lambda/emailSender", () => ({
  sendUsageAlert: jest.fn(),
  sendSuspensionNotification: jest.fn(),
}));

const mockUserAccountsService = UserAccountsService as jest.Mocked<
  typeof UserAccountsService
>;
const mockUsageRecordsService = UsageRecordsService as jest.Mocked<
  typeof UsageRecordsService
>;
const mockBillingUtils = BillingUtils as jest.Mocked<typeof BillingUtils>;

// Import mocked email functions
const {
  sendUsageAlert,
  sendSuspensionNotification,
} = require("../lambda/emailSender");

describe("UsageLimitsChecker", () => {
  const mockUserAccount: UserAccount = {
    userId: "user-123",
    githubUsername: "testuser",
    email: "test@example.com",
    billingPreferences: {
      frequency: "monthly",
      currency: "USD",
      alertThresholds: [50, 80, 95],
    },
    paymentMethods: [],
    usageLimits: {
      monthlyLimit: 100,
      alertAt80Percent: true,
      suspendOnExceed: true,
    },
    status: "active",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBillingUtils.getCurrentBillingPeriod.mockReturnValue("2024-01");
  });

  describe("checkUserUsageLimits", () => {
    it("should return no action when user has no limits set", async () => {
      const userWithoutLimits = {
        ...mockUserAccount,
        usageLimits: {
          alertAt80Percent: true,
          suspendOnExceed: false,
        },
      };

      mockUserAccountsService.getUserAccount.mockResolvedValue(
        userWithoutLimits
      );
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(result).toEqual({
        userId: "user-123",
        currentUsage: 50,
        limit: null,
        usagePercentage: 0,
        alertSent: false,
        suspended: false,
        action: "no limit set",
      });
    });

    it("should skip inactive users", async () => {
      const inactiveUser = {
        ...mockUserAccount,
        status: "suspended" as const,
      };

      mockUserAccountsService.getUserAccount.mockResolvedValue(inactiveUser);

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(result).toEqual({
        userId: "user-123",
        currentUsage: 0,
        limit: null,
        usagePercentage: 0,
        alertSent: false,
        suspended: false,
        action: "skipped - user inactive",
      });
    });

    it("should send alert when usage reaches threshold", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(85); // 85% of 100
      sendUsageAlert.mockResolvedValue();

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(sendUsageAlert).toHaveBeenCalledWith(
        mockUserAccount,
        85,
        100,
        85,
        80 // Highest threshold reached (80% < 85% < 95%)
      );

      expect(result).toEqual({
        userId: "user-123",
        currentUsage: 85,
        limit: 100,
        usagePercentage: 85,
        alertSent: true,
        suspended: false,
        action: "alert sent (80% threshold)",
      });
    });

    it("should suspend user when limit is exceeded", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(105); // Exceeds limit of 100
      mockUserAccountsService.updateUserAccount.mockResolvedValue();
      sendSuspensionNotification.mockResolvedValue();

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(mockUserAccountsService.updateUserAccount).toHaveBeenCalledWith(
        "user-123",
        {
          status: "suspended",
        }
      );

      expect(sendSuspensionNotification).toHaveBeenCalledWith(
        mockUserAccount,
        105,
        100
      );

      expect(result).toEqual({
        userId: "user-123",
        currentUsage: 105,
        limit: 100,
        usagePercentage: 105,
        alertSent: false,
        suspended: true,
        action: "suspended",
      });
    });

    it("should not suspend when suspendOnExceed is false", async () => {
      const userWithoutSuspension = {
        ...mockUserAccount,
        usageLimits: {
          monthlyLimit: 100,
          alertAt80Percent: true,
          suspendOnExceed: false,
        },
      };

      mockUserAccountsService.getUserAccount.mockResolvedValue(
        userWithoutSuspension
      );
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(105);

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(mockUserAccountsService.updateUserAccount).not.toHaveBeenCalled();
      expect(sendSuspensionNotification).not.toHaveBeenCalled();

      expect(result.suspended).toBe(false);
      expect(result.action).toBe("alert sent (95% threshold)");
    });

    it("should handle multiple alert thresholds correctly", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(60); // 60% of 100
      sendUsageAlert.mockResolvedValue();

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(sendUsageAlert).toHaveBeenCalledWith(
        mockUserAccount,
        60,
        100,
        60,
        50 // Highest threshold reached (50% < 60% < 80%)
      );

      expect(result.action).toBe("alert sent (50% threshold)");
    });

    it("should handle email sending failures gracefully", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(85);
      sendUsageAlert.mockRejectedValue(new Error("Email service unavailable"));

      const result = await checkUserUsageLimits("user-123", "2024-01");

      expect(result.alertSent).toBe(false);
      expect(result.action).toBe("no action");
    });

    it("should throw error when user not found", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(null);

      await expect(
        checkUserUsageLimits("nonexistent", "2024-01")
      ).rejects.toThrow("User account not found: nonexistent");
    });
  });

  describe("handler", () => {
    it("should handle individual user check", async () => {
      const event = {
        id: "event-123",
        detail: {
          userId: "user-123",
          billingPeriod: "2024-01",
          checkType: "individual" as const,
        },
      } as any;

      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Individual usage limit check completed");
      expect(result.results).toBeDefined();
    });

    it("should handle batch check", async () => {
      const event = {
        id: "scheduled-event",
        source: "aws.events",
        "detail-type": "Scheduled Event",
      } as any;

      mockBillingUtils.getCurrentBillingPeriod.mockReturnValue("2024-01");
      mockUsageRecordsService.getAllUsageForPeriod.mockResolvedValue([
        {
          PK: "USER#user-123",
          SK: "2024-01-01T00:00:00Z#event-1",
          eventType: "commit",
          repository: "test-repo",
          billingPeriod: "2024-01",
          analysisSuccess: true,
          createdAt: "2024-01-01T00:00:00Z",
          githubUsername: "testuser",
        },
      ]);

      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(1);

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Batch usage limits check completed");
      expect(result.results).toEqual({
        totalUsers: 1,
        alertsSent: 0,
        suspensions: 0,
      });
    });

    it("should handle errors gracefully", async () => {
      const event = {
        id: "event-123",
        detail: {
          userId: "user-123",
          billingPeriod: "2024-01",
          checkType: "individual" as const,
        },
      } as any;

      mockUserAccountsService.getUserAccount.mockRejectedValue(
        new Error("Database error")
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("Usage limits check failed");
    });
  });

  describe("triggerUsageLimitCheck", () => {
    it("should trigger check with current billing period", async () => {
      mockBillingUtils.getCurrentBillingPeriod.mockReturnValue("2024-01");
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      await triggerUsageLimitCheck("user-123");

      expect(mockUserAccountsService.getUserAccount).toHaveBeenCalledWith(
        "user-123"
      );
      expect(mockUsageRecordsService.getUserUsageCount).toHaveBeenCalledWith(
        "user-123",
        "2024-01"
      );
    });

    it("should use provided billing period", async () => {
      mockUserAccountsService.getUserAccount.mockResolvedValue(mockUserAccount);
      mockUsageRecordsService.getUserUsageCount.mockResolvedValue(50);

      await triggerUsageLimitCheck("user-123", "2024-02");

      expect(mockUsageRecordsService.getUserUsageCount).toHaveBeenCalledWith(
        "user-123",
        "2024-02"
      );
    });

    it("should propagate errors", async () => {
      mockUserAccountsService.getUserAccount.mockRejectedValue(
        new Error("Database error")
      );

      await expect(triggerUsageLimitCheck("user-123")).rejects.toThrow(
        "Database error"
      );
    });
  });
});
