import { EventBridgeEvent } from "aws-lambda";
import {
  UsageRecordsService,
  BillingUtils,
  UserAccountsService,
} from "../lib/utils/billingDatabase";
import { UsageEvent } from "../lib/types/billing";
import { AuditLogger } from "../lib/utils/auditLogger";
import { v4 as uuidv4 } from "uuid";

interface BedrockResponseDetail {
  analysisResult: any;
  eventId: string;
  repo: string;
  type: "commit" | "pull_request";
  fileCount: number;
  githubUsername: string;
}

/**
 * Lambda function to track usage events for billing
 * Triggered by successful bedrock.response events
 */
export const handler = async (
  event: EventBridgeEvent<"bedrock.response", BedrockResponseDetail>
): Promise<{ statusCode: number; message?: string }> => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Processing usage tracking event",
      eventId: event.id,
      detail: event.detail,
    })
  );

  const { eventId, repo, type, githubUsername } = event.detail;

  try {
    // Get or create user account based on GitHub username
    let userAccount = await UserAccountsService.getUserAccountByGitHub(
      githubUsername
    );

    if (!userAccount) {
      console.log(
        JSON.stringify({
          level: "info",
          message: "User account not found, creating new account",
          githubUsername,
        })
      );

      // Create a new user account with default settings
      const userId = uuidv4();
      const now = new Date().toISOString();

      userAccount = {
        userId,
        githubUsername,
        email: `${githubUsername}@github.local`, // Placeholder email
        billingPreferences: {
          frequency: "monthly",
          currency: "USD",
          alertThresholds: [80, 95], // Alert at 80% and 95% of usage limits
        },
        paymentMethods: [],
        usageLimits: {
          monthlyLimit: 1000, // Default limit of 1000 events per month
          alertAt80Percent: true,
          suspendOnExceed: true,
        },
        status: "active",
        createdAt: now,
        updatedAt: now,
      };

      await UserAccountsService.createUserAccount(userAccount);
    }

    // Check if user account is active
    if (userAccount.status !== "active") {
      console.log(
        JSON.stringify({
          level: "warn",
          message: "User account is not active, skipping usage tracking",
          githubUsername,
          status: userAccount.status,
        })
      );
      return { statusCode: 200, message: "User account not active" };
    }

    // Create usage event
    const timestamp = new Date().toISOString();
    const billingPeriod = BillingUtils.getCurrentBillingPeriod();

    const usageEvent: UsageEvent = {
      userId: userAccount.userId,
      githubUsername,
      eventType: type === "commit" ? "commit" : "pull_request",
      eventId: eventId, // Use the original event ID for idempotency
      repository: repo,
      timestamp,
      analysisSuccess: true, // Only successful analyses trigger this function
      billingPeriod,
      eventMetadata: {
        fileCount: event.detail.fileCount,
        originalEventId: event.id, // EventBridge event ID
        analysisTimestamp: timestamp,
      },
    };

    // Record usage with idempotency protection
    await UsageRecordsService.recordUsage(usageEvent);

    // Log usage event audit trail
    await AuditLogger.logUsageEvent(eventId, userAccount.userId, "create", {
      source: "usage_tracker",
      eventType: usageEvent.eventType,
      repository: repo,
      billingPeriod,
      githubUsername,
      fileCount: event.detail.fileCount,
      analysisSuccess: true,
    });

    console.log(
      JSON.stringify({
        level: "info",
        message: "Usage event recorded successfully",
        userId: userAccount.userId,
        githubUsername,
        eventType: usageEvent.eventType,
        repository: repo,
        billingPeriod,
        eventId,
      })
    );

    // Check usage limits and send alerts if necessary
    const { triggerUsageLimitCheck } = await import("./usageLimitsChecker");
    await triggerUsageLimitCheck(userAccount.userId, billingPeriod);

    return { statusCode: 200, message: "Usage tracked successfully" };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Error tracking usage",
        error: error instanceof Error ? error.message : String(error),
        eventId,
        githubUsername,
        repo,
      })
    );

    // Don't throw error to prevent EventBridge retries for billing issues
    // Log the error and continue
    return { statusCode: 500, message: "Usage tracking failed" };
  }
};
