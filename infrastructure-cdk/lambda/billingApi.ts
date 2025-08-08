import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  UsageRecordsService,
  UserAccountsService,
  InvoicesService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { UsageRecordItem, Invoice } from "../lib/types/billing";
import { AuditLogger } from "../lib/utils/auditLogger";

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Authentication helper (simplified - in production would use JWT validation)
const authenticateRequest = (event: any): { userId: string } | null => {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  // In production, validate JWT token and extract userId
  // For now, we'll extract userId from a simple token format
  const token = authHeader.replace("Bearer ", "");

  // Simple token validation (in production, use proper JWT validation)
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString());
    if (decoded.userId && typeof decoded.userId === "string") {
      return { userId: decoded.userId };
    }
  } catch (error) {
    console.error("Token validation error:", error);
  }

  return null;
};

// Rate limiting helper
const checkRateLimit = (clientId: string): boolean => {
  const now = Date.now();
  const clientData = rateLimitStore.get(clientId);

  if (!clientData || now > clientData.resetTime) {
    // Reset or initialize rate limit for client
    rateLimitStore.set(clientId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return true;
  }

  if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  clientData.count++;
  return true;
};

// Input validation helpers
const validateUsageHistoryParams = (params: any): string[] => {
  const errors: string[] = [];

  if (params.billingPeriod && !/^\d{4}-\d{2}$/.test(params.billingPeriod)) {
    errors.push("billingPeriod must be in YYYY-MM format");
  }

  if (
    params.limit &&
    (isNaN(params.limit) || params.limit < 1 || params.limit > 1000)
  ) {
    errors.push("limit must be a number between 1 and 1000");
  }

  if (params.offset && (isNaN(params.offset) || params.offset < 0)) {
    errors.push("offset must be a non-negative number");
  }

  return errors;
};

const validateInvoiceParams = (params: any): string[] => {
  const errors: string[] = [];

  if (params.billingPeriod && !/^\d{4}-\d{2}$/.test(params.billingPeriod)) {
    errors.push("billingPeriod must be in YYYY-MM format");
  }

  return errors;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Received billing API event:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };

  try {
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;
    const pathParameters = event.pathParameters || {};
    const queryStringParameters = event.queryStringParameters || {};

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    // Rate limiting
    const clientId =
      (event.requestContext as any).identity?.sourceIp || "unknown";
    if (!checkRateLimit(clientId)) {
      return {
        statusCode: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": "60",
        },
        body: JSON.stringify({ error: "Rate limit exceeded" }),
      };
    }

    // Authentication
    const authResult = authenticateRequest(event);
    if (!authResult) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    const { userId } = authResult;

    // Verify user exists
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Route to appropriate handler
    if (path.includes("/usage-history")) {
      return await handleUsageHistory(
        userId,
        queryStringParameters as Record<string, string>,
        corsHeaders
      );
    } else if (path.includes("/invoices")) {
      if (pathParameters.billingPeriod) {
        return await handleGetInvoice(
          userId,
          pathParameters.billingPeriod,
          corsHeaders
        );
      } else {
        return await handleGetInvoices(
          userId,
          queryStringParameters as Record<string, string>,
          corsHeaders
        );
      }
    } else if (path.includes("/current-usage")) {
      return await handleCurrentUsage(
        userId,
        queryStringParameters as Record<string, string>,
        corsHeaders
      );
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Endpoint not found" }),
    };
  } catch (error) {
    console.error("Error in billing API:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function handleUsageHistory(
  userId: string,
  queryParams: Record<string, string>,
  corsHeaders: Record<string, string>
) {
  try {
    // Validate query parameters
    const validationErrors = validateUsageHistoryParams(queryParams);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ errors: validationErrors }),
      };
    }

    const billingPeriod =
      queryParams.billingPeriod || BillingUtils.getCurrentBillingPeriod();
    const limit = parseInt(queryParams.limit || "100");
    const offset = parseInt(queryParams.offset || "0");

    console.log(
      `Getting usage history for user ${userId}, period ${billingPeriod}`
    );

    // Get usage records for the specified period
    const usageRecords = await UsageRecordsService.getUserUsage(
      userId,
      billingPeriod
    );

    // Apply pagination
    const paginatedRecords = usageRecords
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(offset, offset + limit);

    // Transform records for API response
    const usageHistory = paginatedRecords.map((record) => ({
      eventId: record.SK.split("#")[1],
      eventType: record.eventType,
      repository: record.repository,
      timestamp: record.createdAt,
      billingPeriod: record.billingPeriod,
      analysisSuccess: record.analysisSuccess,
    }));

    const response = {
      usageHistory,
      pagination: {
        total: usageRecords.length,
        limit,
        offset,
        hasMore: offset + limit < usageRecords.length,
      },
      summary: {
        billingPeriod,
        totalEvents: usageRecords.length,
        successfulEvents: usageRecords.filter((r) => r.analysisSuccess).length,
      },
    };

    // Log billing data access audit event
    await AuditLogger.logBillingEvent(
      "usage_record",
      `${userId}#${billingPeriod}`,
      "process", // Using process for data retrieval
      userId,
      "user",
      userId,
      undefined,
      {
        source: "billing_api",
        action: "get_usage_history",
        billingPeriod,
        recordCount: usageRecords.length,
        limit,
        offset,
      }
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error getting usage history:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve usage history" }),
    };
  }
}

async function handleCurrentUsage(
  userId: string,
  queryParams: Record<string, string>,
  corsHeaders: Record<string, string>
) {
  try {
    const billingPeriod =
      queryParams.billingPeriod || BillingUtils.getCurrentBillingPeriod();

    console.log(
      `Getting current usage for user ${userId}, period ${billingPeriod}`
    );

    // Get usage count for current period
    const usageCount = await UsageRecordsService.getUserUsageCount(
      userId,
      billingPeriod
    );

    // Get user account for usage limits
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Calculate usage percentage if limit is set
    let usagePercentage: number | undefined;
    let isNearLimit = false;
    let isOverLimit = false;

    if (userAccount.usageLimits.monthlyLimit) {
      usagePercentage =
        (usageCount / userAccount.usageLimits.monthlyLimit) * 100;
      isNearLimit = usagePercentage >= 80;
      isOverLimit = usagePercentage >= 100;
    }

    const response = {
      billingPeriod,
      usageCount,
      usageLimit: userAccount.usageLimits.monthlyLimit,
      usagePercentage,
      isNearLimit,
      isOverLimit,
      alertThresholds: userAccount.billingPreferences.alertThresholds,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error getting current usage:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve current usage" }),
    };
  }
}

async function handleGetInvoices(
  userId: string,
  queryParams: Record<string, string>,
  corsHeaders: Record<string, string>
) {
  try {
    console.log(`Getting invoices for user ${userId}`);

    // Get all invoices for the user
    const invoices = await InvoicesService.getUserInvoices(userId);

    // Sort by billing period (most recent first)
    invoices.sort((a, b) => b.billingPeriod.localeCompare(a.billingPeriod));

    // Apply filtering if requested
    let filteredInvoices = invoices;
    if (queryParams.status) {
      const statusFilter = queryParams.status;
      filteredInvoices = invoices.filter(
        (invoice) => invoice.status === statusFilter
      );
    }

    // Transform invoices for API response (remove sensitive data)
    const invoiceList = filteredInvoices.map((invoice) => ({
      invoiceId: invoice.invoiceId,
      billingPeriod: invoice.billingPeriod,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paidDate: invoice.paidDate,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      lineItemsCount: invoice.lineItems.length,
    }));

    const response = {
      invoices: invoiceList,
      summary: {
        total: filteredInvoices.length,
        pending: filteredInvoices.filter((i) => i.status === "pending").length,
        paid: filteredInvoices.filter((i) => i.status === "paid").length,
        overdue: filteredInvoices.filter((i) => i.status === "overdue").length,
        failed: filteredInvoices.filter((i) => i.status === "failed").length,
      },
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error getting invoices:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve invoices" }),
    };
  }
}

async function handleGetInvoice(
  userId: string,
  billingPeriod: string,
  corsHeaders: Record<string, string>
) {
  try {
    // Validate billing period format
    const validationErrors = validateInvoiceParams({ billingPeriod });
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ errors: validationErrors }),
      };
    }

    console.log(`Getting invoice for user ${userId}, period ${billingPeriod}`);

    // Get specific invoice
    const invoice = await InvoicesService.getInvoice(userId, billingPeriod);
    if (!invoice) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invoice not found" }),
      };
    }

    // Return full invoice details
    const response = {
      invoice: {
        invoiceId: invoice.invoiceId,
        billingPeriod: invoice.billingPeriod,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        paidDate: invoice.paidDate,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        lineItems: invoice.lineItems,
        paymentAttempts: invoice.paymentAttempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          timestamp: attempt.timestamp,
          amount: attempt.amount,
          status: attempt.status,
          failureReason: attempt.failureReason,
          // Don't expose Stripe payment intent ID
        })),
      },
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("Error getting invoice:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve invoice" }),
    };
  }
}
