import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { UserAccountsService } from "../lib/utils/billingDatabase";
import {
  UserAccount,
  BillingPreferences,
  UsageLimits,
} from "../lib/types/billing";

const client = new DynamoDBClient({});

const TABLE_NAME = process.env.TABLE_NAME!;

// Default values for new accounts
const getDefaultBillingPreferences = (): BillingPreferences => ({
  frequency: "monthly",
  currency: "USD",
  alertThresholds: [50, 80, 100],
});

const getDefaultUsageLimits = (): UsageLimits => ({
  alertAt80Percent: true,
  suspendOnExceed: false,
});

// Validation functions
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateGitHubUsername = (username: string): boolean => {
  const githubUsernameRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
  return githubUsernameRegex.test(username);
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Received event:", JSON.stringify(event));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  try {
    if (!TABLE_NAME) {
      console.error("Environment variable TABLE_NAME is not set.");
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Server configuration error: Table name is not set.",
        }),
      };
    }

    // Handle CORS preflight
    if (event.requestContext.http.method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    const body = JSON.parse(event.body || "{}");
    console.log("Parsed body:", body);
    const email = body.email;
    const githubUsername = body.githubUsername;

    if (!email || !githubUsername) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Email and githubUsername are required",
        }),
      };
    }

    // Validate input format
    if (!validateEmail(email)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid email format" }),
      };
    }

    if (!validateGitHubUsername(githubUsername)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid GitHub username format" }),
      };
    }

    // Check if user already exists
    const existingUser = await UserAccountsService.getUserAccountByGitHub(
      githubUsername
    );
    if (existingUser) {
      console.log("User already exists, updating email if different");

      // Update email if it's different
      if (existingUser.email !== email) {
        await UserAccountsService.updateUserAccount(existingUser.userId, {
          email,
        });
        console.log("Email updated for existing user");
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "User account already exists",
          userId: existingUser.userId,
          isNewUser: false,
        }),
      };
    }

    // Create both legacy format (for backward compatibility) and new user account
    const legacyItem = {
      PK: { S: `GITHUBUSER#${githubUsername}` },
      SK: { S: "PROFILE" },
      Email: { S: email },
      GitHubUsername: { S: githubUsername },
    };

    console.log("PutItemCommand input:", {
      TableName: TABLE_NAME,
      Item: legacyItem,
    });

    // Insert legacy format
    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: legacyItem,
      })
    );

    // Create new user account with billing capabilities
    const userId = uuidv4();
    const now = new Date().toISOString();

    const userAccount: UserAccount = {
      userId,
      githubUsername,
      email,
      billingPreferences: getDefaultBillingPreferences(),
      paymentMethods: [],
      usageLimits: getDefaultUsageLimits(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    await UserAccountsService.createUserAccount(userAccount);

    console.log("Successfully created user account and legacy record:", userId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Email registered and user account created",
        userId,
        isNewUser: true,
      }),
    };
  } catch (err) {
    console.error("Error occurred while registering email:", err);

    // Handle specific error cases
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account already exists" }),
      };
    }

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Error registering email" }),
    };
  }
};
