import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";
import {
  AuditLogEntry,
  AuditLogItem,
  AuditEventType,
  AuditEntityType,
  AuditAction,
  AuditChange,
} from "../types/billing";

// Initialize DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Single table name from environment variables
const TABLE_NAME = process.env.TABLE_NAME || "";

/**
 * Audit Logger Service
 * Provides immutable audit logging for all billing events with cryptographic integrity
 */
export class AuditLogger {
  /**
   * Log an audit event with cryptographic integrity
   */
  static async logEvent(entry: AuditLogEntry): Promise<void> {
    const auditId = entry.auditId || this.generateAuditId();
    const timestamp = entry.timestamp || new Date().toISOString();

    // Create hash for integrity verification
    const hash = this.createIntegrityHash(entry, timestamp);

    const item: AuditLogItem = {
      PK: `AUDIT#${entry.entityType}#${entry.entityId}`,
      SK: `${timestamp}#${auditId}`,
      userId: entry.userId,
      eventType: entry.eventType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actorId,
      actorType: entry.actorType,
      changes: entry.changes,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      hash,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        // Ensure immutability - never overwrite existing audit entries
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  }

  /**
   * Log a billing event (usage tracking, invoice generation, etc.)
   */
  static async logBillingEvent(
    entityType: AuditEntityType,
    entityId: string,
    action: AuditAction,
    actorId: string,
    actorType: "user" | "system" | "admin",
    userId?: string,
    changes?: AuditChange[],
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      auditId: this.generateAuditId(),
      userId,
      eventType: "billing_event",
      entityType,
      entityId,
      action,
      timestamp: new Date().toISOString(),
      actorId,
      actorType,
      changes,
      metadata,
    });
  }

  /**
   * Log an account modification event
   */
  static async logAccountModification(
    userId: string,
    action: AuditAction,
    actorId: string,
    actorType: "user" | "system" | "admin",
    changes?: AuditChange[],
    metadata?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      auditId: this.generateAuditId(),
      userId,
      eventType: "account_modification",
      entityType: "user_account",
      entityId: userId,
      action,
      timestamp: new Date().toISOString(),
      actorId,
      actorType,
      changes,
      metadata,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log a pricing change event
   */
  static async logPricingChange(
    tierId: string,
    action: AuditAction,
    actorId: string,
    changes?: AuditChange[],
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      auditId: this.generateAuditId(),
      eventType: "pricing_change",
      entityType: "pricing_tier",
      entityId: tierId,
      action,
      timestamp: new Date().toISOString(),
      actorId,
      actorType: "admin",
      changes,
      metadata,
    });
  }

  /**
   * Log a payment event
   */
  static async logPaymentEvent(
    invoiceId: string,
    userId: string,
    action: AuditAction,
    actorId: string,
    actorType: "user" | "system" | "admin",
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      auditId: this.generateAuditId(),
      userId,
      eventType: "payment_event",
      entityType: "invoice",
      entityId: invoiceId,
      action,
      timestamp: new Date().toISOString(),
      actorId,
      actorType,
      metadata,
    });
  }

  /**
   * Log a usage event
   */
  static async logUsageEvent(
    eventId: string,
    userId: string,
    action: AuditAction,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      auditId: this.generateAuditId(),
      userId,
      eventType: "usage_event",
      entityType: "usage_record",
      entityId: eventId,
      action,
      timestamp: new Date().toISOString(),
      actorId: "system",
      actorType: "system",
      metadata,
    });
  }

  /**
   * Get audit logs for a specific entity
   */
  static async getEntityAuditLogs(
    entityType: AuditEntityType,
    entityId: string,
    limit?: number,
    startTime?: string,
    endTime?: string
  ): Promise<AuditLogEntry[]> {
    let keyConditionExpression = "PK = :pk";
    const expressionAttributeValues: Record<string, any> = {
      ":pk": `AUDIT#${entityType}#${entityId}`,
    };

    // Add time range filtering if provided
    if (startTime && endTime) {
      keyConditionExpression += " AND SK BETWEEN :startTime AND :endTime";
      expressionAttributeValues[":startTime"] = startTime;
      expressionAttributeValues[":endTime"] = endTime;
    } else if (startTime) {
      keyConditionExpression += " AND SK >= :startTime";
      expressionAttributeValues[":startTime"] = startTime;
    } else if (endTime) {
      keyConditionExpression += " AND SK <= :endTime";
      expressionAttributeValues[":endTime"] = endTime;
    }

    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (response.Items as AuditLogItem[]).map(this.itemToAuditLogEntry);
  }

  /**
   * Get audit logs for a specific user
   */
  static async getUserAuditLogs(
    userId: string,
    limit?: number,
    startTime?: string,
    endTime?: string
  ): Promise<AuditLogEntry[]> {
    let filterExpression = "userId = :userId";
    const expressionAttributeValues: Record<string, any> = {
      ":userId": userId,
    };

    // Add time range filtering if provided
    if (startTime && endTime) {
      filterExpression += " AND SK BETWEEN :startTime AND :endTime";
      expressionAttributeValues[":startTime"] = startTime;
      expressionAttributeValues[":endTime"] = endTime;
    } else if (startTime) {
      filterExpression += " AND SK >= :startTime";
      expressionAttributeValues[":startTime"] = startTime;
    } else if (endTime) {
      filterExpression += " AND SK <= :endTime";
      expressionAttributeValues[":endTime"] = endTime;
    }

    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "UserAuditIndex", // GSI on userId
        KeyConditionExpression: "userId = :userId",
        FilterExpression:
          startTime || endTime
            ? filterExpression.replace("userId = :userId AND ", "")
            : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (response.Items as AuditLogItem[]).map(this.itemToAuditLogEntry);
  }

  /**
   * Get audit logs by event type
   */
  static async getAuditLogsByEventType(
    eventType: AuditEventType,
    limit?: number,
    startTime?: string,
    endTime?: string
  ): Promise<AuditLogEntry[]> {
    let filterExpression = "eventType = :eventType";
    const expressionAttributeValues: Record<string, any> = {
      ":eventType": eventType,
    };

    // Add time range filtering if provided
    if (startTime && endTime) {
      filterExpression += " AND SK BETWEEN :startTime AND :endTime";
      expressionAttributeValues[":startTime"] = startTime;
      expressionAttributeValues[":endTime"] = endTime;
    } else if (startTime) {
      filterExpression += " AND SK >= :startTime";
      expressionAttributeValues[":startTime"] = startTime;
    } else if (endTime) {
      filterExpression += " AND SK <= :endTime";
      expressionAttributeValues[":endTime"] = endTime;
    }

    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "EventTypeIndex", // GSI on eventType
        KeyConditionExpression: "eventType = :eventType",
        FilterExpression:
          startTime || endTime
            ? filterExpression.replace("eventType = :eventType AND ", "")
            : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (response.Items as AuditLogItem[]).map(this.itemToAuditLogEntry);
  }

  /**
   * Verify the integrity of an audit log entry
   */
  static verifyIntegrity(entry: AuditLogEntry, storedHash: string): boolean {
    const calculatedHash = this.createIntegrityHash(entry, entry.timestamp);
    return calculatedHash === storedHash;
  }

  /**
   * Get audit trail for billing disputes
   */
  static async getBillingDisputeTrail(
    userId: string,
    billingPeriod: string,
    startTime?: string,
    endTime?: string
  ): Promise<AuditLogEntry[]> {
    // Get all billing-related audit logs for the user in the specified period
    const billingLogs = await this.getUserAuditLogs(
      userId,
      undefined,
      startTime,
      endTime
    );

    // Filter for billing-related events
    return billingLogs.filter(
      (log) =>
        log.eventType === "billing_event" ||
        log.eventType === "usage_event" ||
        log.eventType === "payment_event" ||
        (log.metadata && log.metadata.billingPeriod === billingPeriod)
    );
  }

  /**
   * Generate a unique audit ID
   */
  private static generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Create cryptographic hash for integrity verification
   */
  private static createIntegrityHash(
    entry: AuditLogEntry,
    timestamp: string
  ): string {
    const hashData = {
      auditId: entry.auditId,
      userId: entry.userId,
      eventType: entry.eventType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      timestamp,
      actorId: entry.actorId,
      actorType: entry.actorType,
      changes: entry.changes,
      metadata: entry.metadata,
    };

    return createHash("sha256")
      .update(JSON.stringify(hashData, Object.keys(hashData).sort()))
      .digest("hex");
  }

  /**
   * Convert DynamoDB item to AuditLogEntry
   */
  private static itemToAuditLogEntry(item: AuditLogItem): AuditLogEntry {
    const [timestamp, auditId] = item.SK.split("#");

    return {
      auditId,
      userId: item.userId,
      eventType: item.eventType as AuditEventType,
      entityType: item.entityType as AuditEntityType,
      entityId: item.entityId,
      action: item.action as AuditAction,
      timestamp,
      actorId: item.actorId,
      actorType: item.actorType as "user" | "system" | "admin",
      changes: item.changes,
      metadata: item.metadata,
      ipAddress: item.ipAddress,
      userAgent: item.userAgent,
    };
  }
}

/**
 * Audit Logger Middleware
 * Helper functions to integrate audit logging with existing services
 */
export class AuditLoggerMiddleware {
  /**
   * Wrap a function to automatically log audit events
   */
  static withAuditLog<T extends any[], R>(
    eventType: AuditEventType,
    entityType: AuditEntityType,
    action: AuditAction,
    getEntityId: (...args: T) => string,
    getActorInfo: (...args: T) => {
      actorId: string;
      actorType: "user" | "system" | "admin";
    },
    getUserId?: (...args: T) => string | undefined,
    getChanges?: (...args: T) => AuditChange[] | undefined,
    getMetadata?: (...args: T) => Record<string, any> | undefined
  ) {
    return function (originalFunction: (...args: T) => Promise<R>) {
      return async function (...args: T): Promise<R> {
        const entityId = getEntityId(...args);
        const { actorId, actorType } = getActorInfo(...args);
        const userId = getUserId?.(...args);
        const changes = getChanges?.(...args);
        const metadata = getMetadata?.(...args);

        try {
          const result = await originalFunction(...args);

          // Log successful operation
          await AuditLogger.logEvent({
            auditId: AuditLogger["generateAuditId"](),
            userId,
            eventType,
            entityType,
            entityId,
            action,
            timestamp: new Date().toISOString(),
            actorId,
            actorType,
            changes,
            metadata: {
              ...metadata,
              success: true,
            },
          });

          return result;
        } catch (error) {
          // Log failed operation
          await AuditLogger.logEvent({
            auditId: AuditLogger["generateAuditId"](),
            userId,
            eventType,
            entityType,
            entityId,
            action,
            timestamp: new Date().toISOString(),
            actorId,
            actorType,
            changes,
            metadata: {
              ...metadata,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
          });

          throw error;
        }
      };
    };
  }
}
