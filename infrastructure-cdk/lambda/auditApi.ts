import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { AuditLogger } from "../lib/utils/auditLogger";
import { AuditEventType, AuditEntityType } from "../lib/types/billing";

/**
 * API handler for audit log operations
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };

  try {
    // Handle CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers,
        body: "",
      };
    }

    // Extract user ID from JWT token (simplified - in real implementation, validate JWT)
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Authorization header required" }),
      };
    }

    // In a real implementation, you would validate the JWT token here
    // For now, we'll extract userId from the token payload (mock)
    const userId = extractUserIdFromToken(authHeader);
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Invalid authorization token" }),
      };
    }

    const path = event.path;
    const method = event.httpMethod;
    const queryParams = event.queryStringParameters || {};

    // Route requests
    if (method === "GET") {
      if (path.endsWith("/audit/user")) {
        return await getUserAuditLogs(userId, queryParams, headers);
      } else if (path.endsWith("/audit/entity")) {
        return await getEntityAuditLogs(queryParams, headers);
      } else if (path.endsWith("/audit/billing-dispute")) {
        return await getBillingDisputeTrail(userId, queryParams, headers);
      } else if (path.endsWith("/audit/events")) {
        return await getAuditLogsByEventType(queryParams, headers);
      } else if (path.match(/\/audit\/entity\/[^\/]+\/[^\/]+$/)) {
        // Extract entity type and ID from path
        const pathParts = path.split("/");
        const entityType = pathParts[pathParts.length - 2] as AuditEntityType;
        const entityId = pathParts[pathParts.length - 1];
        return await getSpecificEntityAuditLogs(
          entityType,
          entityId,
          queryParams,
          headers
        );
      }
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: "Endpoint not found" }),
    };
  } catch (error) {
    console.error("Audit API error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

/**
 * Get audit logs for the authenticated user
 */
async function getUserAuditLogs(
  userId: string,
  queryParams: Record<string, string | undefined>,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const limit = queryParams.limit ? parseInt(queryParams.limit) : 50;
  const startTime = queryParams.startTime;
  const endTime = queryParams.endTime;

  if (limit > 1000) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Limit cannot exceed 1000" }),
    };
  }

  const auditLogs = await AuditLogger.getUserAuditLogs(
    userId,
    limit,
    startTime,
    endTime
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      auditLogs,
      count: auditLogs.length,
      filters: {
        userId,
        limit,
        startTime,
        endTime,
      },
    }),
  };
}

/**
 * Get audit logs for a specific entity (admin only)
 */
async function getEntityAuditLogs(
  queryParams: Record<string, string | undefined>,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const entityType = queryParams.entityType as AuditEntityType;
  const entityId = queryParams.entityId;
  const limit = queryParams.limit ? parseInt(queryParams.limit) : 50;
  const startTime = queryParams.startTime;
  const endTime = queryParams.endTime;

  if (!entityType || !entityId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "entityType and entityId are required parameters",
      }),
    };
  }

  if (limit > 1000) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Limit cannot exceed 1000" }),
    };
  }

  const auditLogs = await AuditLogger.getEntityAuditLogs(
    entityType,
    entityId,
    limit,
    startTime,
    endTime
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      auditLogs,
      count: auditLogs.length,
      filters: {
        entityType,
        entityId,
        limit,
        startTime,
        endTime,
      },
    }),
  };
}

/**
 * Get audit logs for a specific entity by path parameters
 */
async function getSpecificEntityAuditLogs(
  entityType: AuditEntityType,
  entityId: string,
  queryParams: Record<string, string | undefined>,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const limit = queryParams.limit ? parseInt(queryParams.limit) : 50;
  const startTime = queryParams.startTime;
  const endTime = queryParams.endTime;

  if (limit > 1000) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Limit cannot exceed 1000" }),
    };
  }

  const auditLogs = await AuditLogger.getEntityAuditLogs(
    entityType,
    entityId,
    limit,
    startTime,
    endTime
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      auditLogs,
      count: auditLogs.length,
      filters: {
        entityType,
        entityId,
        limit,
        startTime,
        endTime,
      },
    }),
  };
}

/**
 * Get billing dispute trail for a user
 */
async function getBillingDisputeTrail(
  userId: string,
  queryParams: Record<string, string | undefined>,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const billingPeriod = queryParams.billingPeriod;
  const startTime = queryParams.startTime;
  const endTime = queryParams.endTime;

  if (!billingPeriod) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "billingPeriod is required parameter",
      }),
    };
  }

  const auditLogs = await AuditLogger.getBillingDisputeTrail(
    userId,
    billingPeriod,
    startTime,
    endTime
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      auditLogs,
      count: auditLogs.length,
      billingPeriod,
      userId,
      disputeTrail: {
        usageEvents: auditLogs.filter((log) => log.eventType === "usage_event"),
        billingEvents: auditLogs.filter(
          (log) => log.eventType === "billing_event"
        ),
        paymentEvents: auditLogs.filter(
          (log) => log.eventType === "payment_event"
        ),
      },
    }),
  };
}

/**
 * Get audit logs by event type (admin only)
 */
async function getAuditLogsByEventType(
  queryParams: Record<string, string | undefined>,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const eventType = queryParams.eventType as AuditEventType;
  const limit = queryParams.limit ? parseInt(queryParams.limit) : 50;
  const startTime = queryParams.startTime;
  const endTime = queryParams.endTime;

  if (!eventType) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "eventType is required parameter",
      }),
    };
  }

  if (limit > 1000) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Limit cannot exceed 1000" }),
    };
  }

  const auditLogs = await AuditLogger.getAuditLogsByEventType(
    eventType,
    limit,
    startTime,
    endTime
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      auditLogs,
      count: auditLogs.length,
      filters: {
        eventType,
        limit,
        startTime,
        endTime,
      },
    }),
  };
}

/**
 * Extract user ID from JWT token (simplified implementation)
 * In a real implementation, you would properly validate the JWT
 */
function extractUserIdFromToken(authHeader: string): string | null {
  try {
    // Remove "Bearer " prefix
    const token = authHeader.replace(/^Bearer\s+/, "");

    // In a real implementation, you would:
    // 1. Verify the JWT signature
    // 2. Check expiration
    // 3. Validate issuer
    // 4. Extract claims

    // For now, we'll just decode the payload (unsafe - for demo only)
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );

    return payload.sub || payload.userId || null;
  } catch (error) {
    console.error("Error extracting user ID from token:", error);
    return null;
  }
}

/**
 * Validate admin permissions (simplified implementation)
 */
function validateAdminPermissions(authHeader: string): boolean {
  try {
    const token = authHeader.replace(/^Bearer\s+/, "");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );

    return (
      payload.role === "admin" || payload.permissions?.includes("audit:read")
    );
  } catch (error) {
    return false;
  }
}
