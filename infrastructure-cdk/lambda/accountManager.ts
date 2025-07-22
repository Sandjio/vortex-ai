import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  UserAccountsService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import {
  UserAccount,
  BillingPreferences,
  UsageLimits,
} from "../lib/types/billing";

// Validation functions
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateGitHubUsername = (username: string): boolean => {
  const githubUsernameRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
  return githubUsernameRegex.test(username);
};

const validateBillingPreferences = (
  preferences: any
): preferences is BillingPreferences => {
  return (
    preferences &&
    typeof preferences === "object" &&
    ["monthly", "quarterly"].includes(preferences.frequency) &&
    typeof preferences.currency === "string" &&
    Array.isArray(preferences.alertThresholds) &&
    preferences.alertThresholds.every(
      (threshold: any) => typeof threshold === "number"
    )
  );
};

const validateUsageLimits = (limits: any): limits is UsageLimits => {
  return (
    limits &&
    typeof limits === "object" &&
    (limits.monthlyLimit === undefined ||
      typeof limits.monthlyLimit === "number") &&
    typeof limits.alertAt80Percent === "boolean" &&
    typeof limits.suspendOnExceed === "boolean"
  );
};

const validateUserAccountData = (data: any): string[] => {
  const errors: string[] = [];

  if (!data.email || !validateEmail(data.email)) {
    errors.push("Valid email is required");
  }

  if (!data.githubUsername || !validateGitHubUsername(data.githubUsername)) {
    errors.push("Valid GitHub username is required");
  }

  if (
    data.billingPreferences &&
    !validateBillingPreferences(data.billingPreferences)
  ) {
    errors.push("Invalid billing preferences format");
  }

  if (data.usageLimits && !validateUsageLimits(data.usageLimits)) {
    errors.push("Invalid usage limits format");
  }

  return errors;
};

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

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };

  try {
    const method = event.requestContext.http.method;
    const pathParameters = event.pathParameters || {};

    switch (method) {
      case "OPTIONS":
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: "",
        };

      case "POST":
        return await createUserAccount(event, corsHeaders);

      case "GET":
        if (pathParameters.userId) {
          return await getUserAccount(pathParameters.userId, corsHeaders);
        } else if (event.queryStringParameters?.githubUsername) {
          return await getUserAccountByGitHub(
            event.queryStringParameters.githubUsername,
            corsHeaders
          );
        }
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "User ID or GitHub username required",
          }),
        };

      case "PUT":
        if (pathParameters.userId) {
          return await updateUserAccount(
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

      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Method not allowed" }),
        };
    }
  } catch (error) {
    console.error("Error in account manager:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function createUserAccount(
  event: any,
  corsHeaders: Record<string, string>
) {
  try {
    const body = JSON.parse(event.body || "{}");
    console.log("Creating user account with data:", body);

    // Validate input data
    const validationErrors = validateUserAccountData(body);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ errors: validationErrors }),
      };
    }

    // Check if user already exists by GitHub username
    const existingUser = await UserAccountsService.getUserAccountByGitHub(
      body.githubUsername
    );
    if (existingUser) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account already exists" }),
      };
    }

    // Generate user ID and create account
    const userId = uuidv4();
    const now = new Date().toISOString();

    const userAccount: UserAccount = {
      userId,
      githubUsername: body.githubUsername,
      email: body.email,
      billingPreferences:
        body.billingPreferences || getDefaultBillingPreferences(),
      paymentMethods: [],
      usageLimits: body.usageLimits || getDefaultUsageLimits(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    await UserAccountsService.createUserAccount(userAccount);

    console.log("User account created successfully:", userId);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "User account created successfully",
        userId,
        userAccount: {
          ...userAccount,
          paymentMethods: [], // Don't expose payment methods in creation response
        },
      }),
    };
  } catch (error) {
    console.error("Error creating user account:", error);

    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
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
      body: JSON.stringify({ error: "Failed to create user account" }),
    };
  }
}

async function getUserAccount(
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    console.log("Getting user account for ID:", userId);

    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Load payment methods
    const paymentMethods = await UserAccountsService.getPaymentMethods(userId);
    userAccount.paymentMethods = paymentMethods;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ userAccount }),
    };
  } catch (error) {
    console.error("Error getting user account:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve user account" }),
    };
  }
}

async function getUserAccountByGitHub(
  githubUsername: string,
  corsHeaders: Record<string, string>
) {
  try {
    console.log("Getting user account for GitHub username:", githubUsername);

    if (!validateGitHubUsername(githubUsername)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid GitHub username format" }),
      };
    }

    const userAccount = await UserAccountsService.getUserAccountByGitHub(
      githubUsername
    );
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Load payment methods
    const paymentMethods = await UserAccountsService.getPaymentMethods(
      userAccount.userId
    );
    userAccount.paymentMethods = paymentMethods;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ userAccount }),
    };
  } catch (error) {
    console.error("Error getting user account by GitHub username:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve user account" }),
    };
  }
}

async function updateUserAccount(
  event: any,
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    const body = JSON.parse(event.body || "{}");
    console.log("Updating user account:", userId, "with data:", body);

    // Validate that user exists
    const existingUser = await UserAccountsService.getUserAccount(userId);
    if (!existingUser) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Validate update data
    const updates: Partial<UserAccount> = {};

    if (body.email !== undefined) {
      if (!validateEmail(body.email)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid email format" }),
        };
      }
      updates.email = body.email;
    }

    if (body.billingPreferences !== undefined) {
      if (!validateBillingPreferences(body.billingPreferences)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid billing preferences format" }),
        };
      }
      updates.billingPreferences = body.billingPreferences;
    }

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

    if (body.status !== undefined) {
      if (!["active", "suspended", "cancelled"].includes(body.status)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Invalid status value" }),
        };
      }
      updates.status = body.status;
    }

    if (Object.keys(updates).length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No valid updates provided" }),
      };
    }

    await UserAccountsService.updateUserAccount(userId, updates);

    console.log("User account updated successfully:", userId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: "User account updated successfully" }),
    };
  } catch (error) {
    console.error("Error updating user account:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to update user account" }),
    };
  }
}
