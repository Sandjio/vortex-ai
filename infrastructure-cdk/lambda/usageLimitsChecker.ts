import { EventBridgeEvent, ScheduledEvent } from "aws-lambda";
import {
  UsageRecordsService,
  UserAccountsService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { UserAccount } from "../lib/types/billing";
import { sendUsageAlert, sendSuspensionNotification } from "./emailSender";

interface UsageLimitCheckEvent {
  userId?: string;
  billingPeriod?: string;
  checkType: "individual" | "batch";
}

/**
 * Lambda function to check usage against user-defined limits
 * Can be triggered by EventBridge schedule or individual user events
 */
export const handler = async (
  event:
    | EventBridgeEvent<"usage.limit.check", UsageLimitCheckEvent>
    | ScheduledEvent
): Promise<{ statusCode: number; message?: string; results?: any }> => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Processing usage limits check",
      eventId: event.id || "scheduled",
      detail: "detail" in event ? event.detail : "scheduled check",
    })
  );

  try {
    if ("detail" in event && event.detail.checkType === "individual") {
      // Check limits for a specific user
      const { userId, billingPeriod } = event.detail;
      if (!userId || !billingPeriod) {
        throw new Error(
          "userId and billingPeriod required for individual check"
        );
      }

      const result = await checkUserUsageLimits(userId, billingPeriod);
      return {
        statusCode: 200,
        message: "Individual usage limit check completed",
        results: result,
      };
    } else {
      // Batch check for all active users
      const results = await checkAllUsersLimits();
      return {
        statusCode: 200,
        message: "Batch usage limits check completed",
        results: {
          totalUsers: results.length,
          alertsSent: results.filter((r) => r.alertSent).length,
          suspensions: results.filter((r) => r.suspended).length,
        },
      };
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Error checking usage limits",
        error: error instanceof Error ? error.message : String(error),
        eventId: event.id || "scheduled",
      })
    );

    return {
      statusCode: 500,
      message: "Usage limits check failed",
    };
  }
};

/**
 * Check usage limits for a specific user
 */
export async function checkUserUsageLimits(
  userId: string,
  billingPeriod: string
): Promise<{
  userId: string;
  currentUsage: number;
  limit: number | null;
  usagePercentage: number;
  alertSent: boolean;
  suspended: boolean;
  action: string;
}> {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Checking usage limits for user",
      userId,
      billingPeriod,
    })
  );

  // Get user account
  const userAccount = await UserAccountsService.getUserAccount(userId);
  if (!userAccount) {
    throw new Error(`User account not found: ${userId}`);
  }

  // Skip if user is already suspended or cancelled
  if (userAccount.status !== "active") {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Skipping usage check for inactive user",
        userId,
        status: userAccount.status,
      })
    );
    return {
      userId,
      currentUsage: 0,
      limit: null,
      usagePercentage: 0,
      alertSent: false,
      suspended: false,
      action: "skipped - user inactive",
    };
  }

  // Get current usage
  const currentUsage = await UsageRecordsService.getUserUsageCount(
    userId,
    billingPeriod
  );

  const usageLimits = userAccount.usageLimits;
  const limit = usageLimits.monthlyLimit;

  // If no limit is set, no action needed
  if (!limit || limit <= 0) {
    return {
      userId,
      currentUsage,
      limit: null,
      usagePercentage: 0,
      alertSent: false,
      suspended: false,
      action: "no limit set",
    };
  }

  const usagePercentage = (currentUsage / limit) * 100;

  console.log(
    JSON.stringify({
      level: "info",
      message: "Usage limit check details",
      userId,
      currentUsage,
      limit,
      usagePercentage: Math.round(usagePercentage),
      alertThresholds: userAccount.billingPreferences.alertThresholds,
    })
  );

  let alertSent = false;
  let suspended = false;
  let action = "no action";

  // Check if user has exceeded their limit
  if (currentUsage >= limit && usageLimits.suspendOnExceed) {
    console.log(
      JSON.stringify({
        level: "warn",
        message: "User exceeded usage limit, suspending account",
        userId,
        currentUsage,
        limit,
      })
    );

    // Suspend user account
    await UserAccountsService.updateUserAccount(userId, {
      status: "suspended",
    });

    // Send suspension notification
    try {
      await sendSuspensionNotification(userAccount, currentUsage, limit);
      console.log(
        JSON.stringify({
          level: "info",
          message: "Suspension notification sent",
          userId,
        })
      );
    } catch (emailError) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Failed to send suspension notification",
          userId,
          error:
            emailError instanceof Error
              ? emailError.message
              : String(emailError),
        })
      );
    }

    suspended = true;
    action = "suspended";
  } else {
    // Check alert thresholds
    const alertThresholds =
      userAccount.billingPreferences.alertThresholds || [];
    const triggeredThreshold = alertThresholds
      .sort((a, b) => b - a) // Sort descending to get highest threshold first
      .find((threshold) => usagePercentage >= threshold);

    if (triggeredThreshold && usageLimits.alertAt80Percent) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "User reached alert threshold",
          userId,
          currentUsage,
          limit,
          usagePercentage: Math.round(usagePercentage),
          threshold: triggeredThreshold,
        })
      );

      // Send alert notification
      try {
        await sendUsageAlert(
          userAccount,
          currentUsage,
          limit,
          usagePercentage,
          triggeredThreshold
        );
        console.log(
          JSON.stringify({
            level: "info",
            message: "Usage alert sent",
            userId,
            threshold: triggeredThreshold,
          })
        );
        alertSent = true;
        action = `alert sent (${triggeredThreshold}% threshold)`;
      } catch (emailError) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Failed to send usage alert",
            userId,
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          })
        );
      }
    }
  }

  return {
    userId,
    currentUsage,
    limit,
    usagePercentage: Math.round(usagePercentage),
    alertSent,
    suspended,
    action,
  };
}

/**
 * Check usage limits for all active users in the current billing period
 */
async function checkAllUsersLimits(): Promise<
  Array<{
    userId: string;
    currentUsage: number;
    limit: number | null;
    usagePercentage: number;
    alertSent: boolean;
    suspended: boolean;
    action: string;
  }>
> {
  const billingPeriod = BillingUtils.getCurrentBillingPeriod();

  console.log(
    JSON.stringify({
      level: "info",
      message: "Starting batch usage limits check",
      billingPeriod,
    })
  );

  // Get all usage records for the current billing period
  const allUsageRecords = await UsageRecordsService.getAllUsageForPeriod(
    billingPeriod
  );

  // Group usage by user
  const userUsageMap = new Map<string, number>();
  for (const record of allUsageRecords) {
    const userId = record.PK.replace("USER#", "");
    userUsageMap.set(userId, (userUsageMap.get(userId) || 0) + 1);
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Found users with usage in current period",
      userCount: userUsageMap.size,
      billingPeriod,
    })
  );

  const results = [];

  // Check limits for each user with usage
  for (const [userId] of userUsageMap) {
    try {
      const result = await checkUserUsageLimits(userId, billingPeriod);
      results.push(result);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Error checking limits for user",
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
      );

      results.push({
        userId,
        currentUsage: 0,
        limit: null,
        usagePercentage: 0,
        alertSent: false,
        suspended: false,
        action: "error",
      });
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "Batch usage limits check completed",
      totalUsers: results.length,
      alertsSent: results.filter((r) => r.alertSent).length,
      suspensions: results.filter((r) => r.suspended).length,
    })
  );

  return results;
}

/**
 * Trigger individual usage limit check for a specific user
 * This can be called from other Lambda functions
 */
export async function triggerUsageLimitCheck(
  userId: string,
  billingPeriod?: string
): Promise<void> {
  const period = billingPeriod || BillingUtils.getCurrentBillingPeriod();

  try {
    await checkUserUsageLimits(userId, period);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Error in triggered usage limit check",
        userId,
        billingPeriod: period,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    throw error;
  }
}
