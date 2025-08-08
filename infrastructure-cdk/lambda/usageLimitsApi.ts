import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  UserAccountsService,
  UsageRecordsService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { UsageLimits, BillingPreferences } from "../lib/types/billing";
import { triggerUsageLimitCheck } from "./usageLimitsChecker";

// Validation functions
const validateUsageLimits = (limits: any): limits is UsageLimits => {
  return (
    limits &&
    typeof limits === "object" &&
    (limits.monthlyLimit === undefined ||
      (typeof limits.monthlyLimit === "number" && limits.monthlyLimit >= 0)) &&
    typeof limits.alertAt80Percent === "boolean" &&
    typeof limits.suspendOnExceed === "boolean"
  );
};

const validateAlertThresholds = (thresholds: any): thresholds is number[] => {
  return (
    Array.isArray(thresholds) &&
    thresholds.every(
      (threshold: any) =>
        typeof threshold === "number" && threshold >= 0 && threshold <= 100
    )
  );
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log(
    "Received usage limits API event:",
    JSON.stringify(event, null, 2)
  );

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };

  try {
    const method = event.requestContext.http.method;
    const pathParameters = event.pathParameters || {};
    const queryStringParameters = event.queryStringParameters || {};

    switch (method) {
      case "OPTIONS":
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: "",
        };

      case "GET":
        if (pathParameters.userId) {
          if (event.routeKey?.includes("/usage")) {
            return await getUserUsage(
              pathParameters.userId,
              queryStringParameters,
              corsHeaders
            );
          } else {
            return await getUserLimits(pathParameters.userId, corsHeaders);
          }
        }
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "User ID required" }),
        };

      case "PUT":
        if (pathParameters.userId) {
          return await updateUserLimits(
            event,
            pathParameters.userId,
            corsHeaders
          );
        }
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "User ID required for updates" }),
        };

      case "POST":
        if (pathParameters.userId && event.routeKey?.includes("/check")) {
          return await triggerLimitCheck(pathParameters.userId, corsHeaders);
        }
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid endpoint" }),
        };

      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Method not allowed" }),
        };
    }
  } catch (error) {
    console.error("Error in usage limits API:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

/**
 * Get user's current usage limits and settings
 */
async function getUserLimits(
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    console.log("Getting usage limits for user:", userId);

    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Get current usage for context
    const billingPeriod = BillingUtils.getCurrentBillingPeriod();
    const currentUsage = await UsageRecordsService.getUserUsageCount(
      userId,
      billingPeriod
    );

    const response = {
      userId,
      usageLimits: userAccount.usageLimits,
      billingPreferences: {
        alertThresholds: userAccount.billingPreferences.alertThresholds,
      },
      currentUsage: {
        billingPeriod,
        eventCount: currentUsage,
        percentage: userAccount.usageLimits.monthlyLimit
          ? Math.round(
              (currentUsage / userAccount.usageLimits.monthlyLimit) * 100
            )
          : 0,
      },
      status: userAccount.status,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error getting user limits:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve usage limits" }),
    };
  }
}

/**
 * Get user's usage history and details
 */
async function getUserUsage(
  userId: string,
  queryParams: Record<string, string>,
  corsHeaders: Record<string, string>
) {
  try {
    console.log(
      "Getting usage history for user:",
      userId,
      "params:",
      queryParams
    );

    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    const billingPeriod =
      queryParams.period || BillingUtils.getCurrentBillingPeriod();

    // Get detailed usage records
    const usageRecords = await UsageRecordsService.getUserUsage(
      userId,
      billingPeriod
    );
    const totalUsage = usageRecords.length;

    // Group by repository and event type
    const usageByRepo = usageRecords.reduce((acc, record) => {
      if (!acc[record.repository]) {
        acc[record.repository] = { commit: 0, pull_request: 0, total: 0 };
      }
      acc[record.repository][record.eventType]++;
      acc[record.repository].total++;
      return acc;
    }, {} as Record<string, { commit: number; pull_request: number; total: number }>);

    const usageByType = usageRecords.reduce((acc, record) => {
      acc[record.eventType] = (acc[record.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const response = {
      userId,
      billingPeriod,
      totalUsage,
      usageLimits: userAccount.usageLimits,
      usagePercentage: userAccount.usageLimits.monthlyLimit
        ? Math.round((totalUsage / userAccount.usageLimits.monthlyLimit) * 100)
        : 0,
      breakdown: {
        byRepository: usageByRepo,
        byEventType: usageByType,
      },
      recentEvents: usageRecords
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 10)
        .map((record) => ({
          eventType: record.eventType,
          repository: record.repository,
          timestamp: record.createdAt,
          eventId: record.SK.split("#")[1],
        })),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error getting user usage:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve usage data" }),
    };
  }
}

/**
 * Update user's usage limits and alert preferences
 */
async function updateUserLimits(
  event: any,
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    const body = JSON.parse(event.body || "{}");
    console.log("Updating usage limits for user:", userId, "with data:", body);

    // Validate that user exists
    const existingUser = await UserAccountsService.getUserAccount(userId);
    if (!existingUser) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    const updates: {
      usageLimits?: UsageLimits;
      billingPreferences?: Partial<BillingPreferences>;
    } = {};

    // Validate and update usage limits
    if (body.usageLimits !== undefined) {
      if (!validateUsageLimits(body.usageLimits)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid usage limits format" }),
        };
      }
      updates.usageLimits = body.usageLimits;
    }

    // Validate and update alert thresholds
    if (body.alertThresholds !== undefined) {
      if (!validateAlertThresholds(body.alertThresholds)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error:
              "Invalid alert thresholds format. Must be array of numbers between 0-100",
          }),
        };
      }
      updates.billingPreferences = {
        ...existingUser.billingPreferences,
        alertThresholds: body.alertThresholds,
      };
    }

    if (Object.keys(updates).length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No valid updates provided" }),
      };
    }

    // Apply updates
    await UserAccountsService.updateUserAccount(userId, updates);

    // If limits were updated and user was previously suspended, check if they should be reactivated
    if (updates.usageLimits && existingUser.status === "suspended") {
      const billingPeriod = BillingUtils.getCurrentBillingPeriod();
      const currentUsage = await UsageRecordsService.getUserUsageCount(
        userId,
        billingPeriod
      );

      if (
        updates.usageLimits.monthlyLimit &&
        currentUsage < updates.usageLimits.monthlyLimit
      ) {
        await UserAccountsService.updateUserAccount(userId, {
          status: "active",
        });
        console.log("User reactivated due to increased usage limit:", userId);
      }
    }

    console.log("Usage limits updated successfully:", userId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Usage limits updated successfully",
        updates: updates,
      }),
    };
  } catch (error) {
    console.error("Error updating usage limits:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to update usage limits" }),
    };
  }
}

/**
 * Manually trigger a usage limit check for a user
 */
async function triggerLimitCheck(
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    console.log("Triggering usage limit check for user:", userId);

    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    const billingPeriod = BillingUtils.getCurrentBillingPeriod();
    const result = await triggerUsageLimitCheck(userId, billingPeriod);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Usage limit check completed",
        userId,
        billingPeriod,
      }),
    };
  } catch (error) {
    console.error("Error triggering usage limit check:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to trigger usage limit check" }),
    };
  }
}
