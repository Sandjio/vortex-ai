import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  UsageEvent,
  UserAccount,
  PaymentMethod,
  Invoice,
  PricingTier,
  UsageRecordItem,
  UserAccountItem,
  PaymentMethodItem,
  InvoiceItem,
  PricingConfigItem,
  AuditChange,
} from "../types/billing";
import { AuditLogger } from "./auditLogger";

// Initialize DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Single table name from environment variables
const TABLE_NAME = process.env.TABLE_NAME || "";

/**
 * Usage Records Operations
 */
export class UsageRecordsService {
  /**
   * Record a billable usage event
   */
  static async recordUsage(usageEvent: UsageEvent): Promise<void> {
    const item: UsageRecordItem = {
      PK: `USER#${usageEvent.userId}`,
      SK: `${usageEvent.timestamp}#${usageEvent.eventId}`,
      eventType: usageEvent.eventType,
      repository: usageEvent.repository,
      billingPeriod: usageEvent.billingPeriod,
      analysisSuccess: usageEvent.analysisSuccess,
      createdAt: usageEvent.timestamp,
      eventMetadata: usageEvent.eventMetadata,
      githubUsername: usageEvent.githubUsername,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)", // Prevent duplicates
      })
    );

    // Log usage event for audit trail
    await AuditLogger.logUsageEvent(
      usageEvent.eventId,
      usageEvent.userId,
      "create",
      {
        eventType: usageEvent.eventType,
        repository: usageEvent.repository,
        billingPeriod: usageEvent.billingPeriod,
        analysisSuccess: usageEvent.analysisSuccess,
        githubUsername: usageEvent.githubUsername,
      }
    );
  }

  /**
   * Get usage records for a user in a specific billing period
   */
  static async getUserUsage(
    userId: string,
    billingPeriod: string
  ): Promise<UsageRecordItem[]> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "BillingPeriodIndex",
        KeyConditionExpression: "billingPeriod = :period",
        FilterExpression: "PK = :userPK AND analysisSuccess = :success",
        ExpressionAttributeValues: {
          ":period": billingPeriod,
          ":userPK": `USER#${userId}`,
          ":success": true,
        },
      })
    );

    return response.Items as UsageRecordItem[];
  }

  /**
   * Get total usage count for a user in a billing period
   */
  static async getUserUsageCount(
    userId: string,
    billingPeriod: string
  ): Promise<number> {
    const records = await this.getUserUsage(userId, billingPeriod);
    return records.length;
  }

  /**
   * Get usage records for all users in a billing period (for billing processing)
   */
  static async getAllUsageForPeriod(
    billingPeriod: string
  ): Promise<UsageRecordItem[]> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "BillingPeriodIndex",
        KeyConditionExpression: "billingPeriod = :period",
        FilterExpression: "analysisSuccess = :success",
        ExpressionAttributeValues: {
          ":period": billingPeriod,
          ":success": true,
        },
      })
    );

    return response.Items as UsageRecordItem[];
  }
}

/**
 * User Accounts Operations
 */
export class UserAccountsService {
  /**
   * Create a new user account
   */
  static async createUserAccount(
    userAccount: UserAccount,
    actorId: string = "system"
  ): Promise<void> {
    const item: UserAccountItem = {
      PK: `USER#${userAccount.userId}`,
      SK: "PROFILE",
      githubUsername: userAccount.githubUsername,
      email: userAccount.email,
      billingPreferences: userAccount.billingPreferences,
      usageLimits: userAccount.usageLimits,
      status: userAccount.status,
      createdAt: userAccount.createdAt,
      updatedAt: userAccount.updatedAt,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );

    // Log account creation for audit trail
    await AuditLogger.logAccountModification(
      userAccount.userId,
      "create",
      actorId,
      "system",
      undefined,
      {
        githubUsername: userAccount.githubUsername,
        email: userAccount.email,
        status: userAccount.status,
      }
    );
  }

  /**
   * Get user account by user ID
   */
  static async getUserAccount(userId: string): Promise<UserAccount | null> {
    const response = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: "PROFILE",
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = response.Item as UserAccountItem;
    return {
      userId,
      githubUsername: item.githubUsername,
      email: item.email,
      billingPreferences: item.billingPreferences,
      paymentMethods: [], // Will be loaded separately
      usageLimits: item.usageLimits,
      status: item.status as "active" | "suspended" | "cancelled",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /**
   * Get user account by GitHub username
   */
  static async getUserAccountByGitHub(
    githubUsername: string
  ): Promise<UserAccount | null> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GitHubUsernameIndex",
        KeyConditionExpression: "githubUsername = :username AND SK = :sk",
        ExpressionAttributeValues: {
          ":username": githubUsername,
          ":sk": "PROFILE",
        },
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    const item = response.Items[0] as UserAccountItem;
    const userId = item.PK.replace("USER#", "");

    return {
      userId,
      githubUsername: item.githubUsername,
      email: item.email,
      billingPreferences: item.billingPreferences,
      paymentMethods: [], // Will be loaded separately
      usageLimits: item.usageLimits,
      status: item.status as "active" | "suspended" | "cancelled",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /**
   * Update user account
   */
  static async updateUserAccount(
    userId: string,
    updates: Partial<UserAccount>,
    actorId: string = "system",
    actorType: "user" | "system" | "admin" = "system"
  ): Promise<void> {
    // Get current account for audit trail
    const currentAccount = await this.getUserAccount(userId);

    const updateExpression: string[] = [];
    const expressionAttributeValues: Record<string, any> = {};
    const expressionAttributeNames: Record<string, string> = {};
    const changes: AuditChange[] = [];

    if (updates.billingPreferences) {
      updateExpression.push("billingPreferences = :billingPreferences");
      expressionAttributeValues[":billingPreferences"] =
        updates.billingPreferences;

      if (currentAccount) {
        changes.push({
          field: "billingPreferences",
          oldValue: currentAccount.billingPreferences,
          newValue: updates.billingPreferences,
        });
      }
    }

    if (updates.usageLimits) {
      updateExpression.push("usageLimits = :usageLimits");
      expressionAttributeValues[":usageLimits"] = updates.usageLimits;

      if (currentAccount) {
        changes.push({
          field: "usageLimits",
          oldValue: currentAccount.usageLimits,
          newValue: updates.usageLimits,
        });
      }
    }

    if (updates.status) {
      updateExpression.push("#status = :status");
      expressionAttributeValues[":status"] = updates.status;
      expressionAttributeNames["#status"] = "status";

      if (currentAccount) {
        changes.push({
          field: "status",
          oldValue: currentAccount.status,
          newValue: updates.status,
        });
      }
    }

    if (updates.email) {
      updateExpression.push("email = :email");
      expressionAttributeValues[":email"] = updates.email;

      if (currentAccount) {
        changes.push({
          field: "email",
          oldValue: currentAccount.email,
          newValue: updates.email,
        });
      }
    }

    updateExpression.push("updatedAt = :updatedAt");
    expressionAttributeValues[":updatedAt"] = new Date().toISOString();

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: "PROFILE",
        },
        UpdateExpression: `SET ${updateExpression.join(", ")}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames:
          Object.keys(expressionAttributeNames).length > 0
            ? expressionAttributeNames
            : undefined,
      })
    );

    // Log account modification for audit trail
    if (changes.length > 0) {
      await AuditLogger.logAccountModification(
        userId,
        "update",
        actorId,
        actorType,
        changes,
        {
          updatedFields: changes.map((c) => c.field),
        }
      );
    }
  }

  /**
   * Add payment method to user account
   */
  static async addPaymentMethod(
    userId: string,
    paymentMethod: PaymentMethod,
    actorId: string = "system",
    actorType: "user" | "system" | "admin" = "user"
  ): Promise<void> {
    const item: PaymentMethodItem = {
      PK: `USER#${userId}`,
      SK: `PAYMENT#${paymentMethod.paymentMethodId}`,
      type: paymentMethod.type,
      last4: paymentMethod.last4,
      expiryMonth: paymentMethod.expiryMonth,
      expiryYear: paymentMethod.expiryYear,
      isDefault: paymentMethod.isDefault,
      stripePaymentMethodId: paymentMethod.stripePaymentMethodId,
      createdAt: paymentMethod.createdAt,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    // Log payment method addition for audit trail
    await AuditLogger.logAccountModification(
      userId,
      "create",
      actorId,
      actorType,
      undefined,
      {
        paymentMethodId: paymentMethod.paymentMethodId,
        type: paymentMethod.type,
        last4: paymentMethod.last4,
        isDefault: paymentMethod.isDefault,
      }
    );
  }

  /**
   * Get payment methods for a user
   */
  static async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "PAYMENT#",
        },
      })
    );

    return (response.Items as PaymentMethodItem[]).map((item) => ({
      paymentMethodId: item.SK.replace("PAYMENT#", ""),
      type: item.type as "card" | "bank_account",
      last4: item.last4,
      expiryMonth: item.expiryMonth,
      expiryYear: item.expiryYear,
      isDefault: item.isDefault,
      stripePaymentMethodId: item.stripePaymentMethodId,
      createdAt: item.createdAt,
    }));
  }

  /**
   * Delete a payment method
   */
  static async deletePaymentMethod(
    userId: string,
    paymentMethodId: string,
    actorId: string = "system",
    actorType: "user" | "system" | "admin" = "user"
  ): Promise<void> {
    // Get payment method details before deletion for audit trail
    const paymentMethods = await this.getPaymentMethods(userId);
    const paymentMethod = paymentMethods.find(
      (pm) => pm.paymentMethodId === paymentMethodId
    );

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `PAYMENT#${paymentMethodId}`,
        },
      })
    );

    // Log payment method deletion for audit trail
    await AuditLogger.logAccountModification(
      userId,
      "delete",
      actorId,
      actorType,
      undefined,
      {
        paymentMethodId,
        deletedPaymentMethod: paymentMethod
          ? {
              type: paymentMethod.type,
              last4: paymentMethod.last4,
              isDefault: paymentMethod.isDefault,
            }
          : null,
      }
    );
  }
}

/**
 * Invoices Operations
 */
export class InvoicesService {
  /**
   * Create a new invoice
   */
  static async createInvoice(
    invoice: Invoice,
    actorId: string = "system"
  ): Promise<void> {
    const item: InvoiceItem = {
      PK: `USER#${invoice.userId}`,
      SK: `INVOICE#${invoice.billingPeriod}`,
      invoiceId: invoice.invoiceId,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paidDate: invoice.paidDate,
      lineItems: invoice.lineItems,
      paymentAttempts: invoice.paymentAttempts,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    // Log invoice creation for audit trail
    await AuditLogger.logBillingEvent(
      "invoice",
      invoice.invoiceId,
      "create",
      actorId,
      "system",
      invoice.userId,
      undefined,
      {
        billingPeriod: invoice.billingPeriod,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        lineItemsCount: invoice.lineItems.length,
      }
    );
  }

  /**
   * Get invoice by user ID and billing period
   */
  static async getInvoice(
    userId: string,
    billingPeriod: string
  ): Promise<Invoice | null> {
    const response = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `INVOICE#${billingPeriod}`,
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = response.Item as InvoiceItem;
    return {
      invoiceId: item.invoiceId,
      userId,
      billingPeriod,
      issueDate: item.issueDate,
      dueDate: item.dueDate,
      paidDate: item.paidDate,
      totalAmount: item.totalAmount,
      status: item.status as "pending" | "paid" | "failed" | "overdue",
      lineItems: item.lineItems,
      paymentAttempts: item.paymentAttempts,
    };
  }

  /**
   * Get all invoices for a user
   */
  static async getUserInvoices(userId: string): Promise<Invoice[]> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "INVOICE#",
        },
      })
    );

    return (response.Items as InvoiceItem[]).map((item) => ({
      invoiceId: item.invoiceId,
      userId,
      billingPeriod: item.SK.replace("INVOICE#", ""),
      issueDate: item.issueDate,
      dueDate: item.dueDate,
      paidDate: item.paidDate,
      totalAmount: item.totalAmount,
      status: item.status as "pending" | "paid" | "failed" | "overdue",
      lineItems: item.lineItems,
      paymentAttempts: item.paymentAttempts,
    }));
  }

  /**
   * Update invoice status
   */
  static async updateInvoiceStatus(
    userId: string,
    billingPeriod: string,
    status: "pending" | "paid" | "failed" | "overdue",
    paidDate?: string,
    actorId: string = "system",
    actorType: "user" | "system" | "admin" = "system"
  ): Promise<void> {
    // Get current invoice for audit trail
    const currentInvoice = await this.getInvoice(userId, billingPeriod);

    const updateExpression = paidDate
      ? "SET #status = :status, paidDate = :paidDate"
      : "SET #status = :status";

    const expressionAttributeValues: Record<string, any> = {
      ":status": status,
    };

    if (paidDate) {
      expressionAttributeValues[":paidDate"] = paidDate;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: `INVOICE#${billingPeriod}`,
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: {
          "#status": "status",
        },
      })
    );

    // Log invoice status update for audit trail
    if (currentInvoice) {
      const changes: AuditChange[] = [];

      if (currentInvoice.status !== status) {
        changes.push({
          field: "status",
          oldValue: currentInvoice.status,
          newValue: status,
        });
      }

      if (paidDate && currentInvoice.paidDate !== paidDate) {
        changes.push({
          field: "paidDate",
          oldValue: currentInvoice.paidDate,
          newValue: paidDate,
        });
      }

      await AuditLogger.logPaymentEvent(
        currentInvoice.invoiceId,
        userId,
        status === "paid" ? "charge" : "process",
        actorId,
        actorType,
        {
          billingPeriod,
          totalAmount: currentInvoice.totalAmount,
          statusChange: `${currentInvoice.status} -> ${status}`,
          paidDate,
        }
      );
    }
  }
}

/**
 * Pricing Configuration Operations
 */
export class PricingConfigService {
  /**
   * Create or update a pricing tier
   */
  static async setPricingTier(
    pricingTier: PricingTier,
    actorId: string = "admin",
    isUpdate: boolean = false
  ): Promise<void> {
    // Get current pricing tier for audit trail if updating
    let currentTier: PricingTier | null = null;
    const changes: AuditChange[] = [];

    if (isUpdate) {
      try {
        const response = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              PK: "PRICING",
              SK: `TIER#${pricingTier.tierId}`,
            },
          })
        );

        if (response.Item) {
          const item = response.Item as PricingConfigItem;
          currentTier = {
            tierId: pricingTier.tierId,
            name: item.name,
            minUsage: item.minUsage,
            maxUsage: item.maxUsage,
            pricePerEvent: item.pricePerEvent,
            effectiveDate: item.effectiveDate,
            isActive: item.isActive,
          };

          // Track changes
          if (currentTier.name !== pricingTier.name) {
            changes.push({
              field: "name",
              oldValue: currentTier.name,
              newValue: pricingTier.name,
            });
          }
          if (currentTier.minUsage !== pricingTier.minUsage) {
            changes.push({
              field: "minUsage",
              oldValue: currentTier.minUsage,
              newValue: pricingTier.minUsage,
            });
          }
          if (currentTier.maxUsage !== pricingTier.maxUsage) {
            changes.push({
              field: "maxUsage",
              oldValue: currentTier.maxUsage,
              newValue: pricingTier.maxUsage,
            });
          }
          if (currentTier.pricePerEvent !== pricingTier.pricePerEvent) {
            changes.push({
              field: "pricePerEvent",
              oldValue: currentTier.pricePerEvent,
              newValue: pricingTier.pricePerEvent,
            });
          }
          if (currentTier.isActive !== pricingTier.isActive) {
            changes.push({
              field: "isActive",
              oldValue: currentTier.isActive,
              newValue: pricingTier.isActive,
            });
          }
        }
      } catch (error) {
        // If we can't get the current tier, proceed without change tracking
        console.warn(
          "Could not retrieve current pricing tier for audit:",
          error
        );
      }
    }

    const item: PricingConfigItem = {
      PK: "PRICING",
      SK: `TIER#${pricingTier.tierId}`,
      name: pricingTier.name,
      minUsage: pricingTier.minUsage,
      maxUsage: pricingTier.maxUsage,
      pricePerEvent: pricingTier.pricePerEvent,
      effectiveDate: pricingTier.effectiveDate,
      isActive: pricingTier.isActive,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    // Log pricing change for audit trail
    await AuditLogger.logPricingChange(
      pricingTier.tierId,
      isUpdate ? "update" : "create",
      actorId,
      changes.length > 0 ? changes : undefined,
      {
        name: pricingTier.name,
        minUsage: pricingTier.minUsage,
        maxUsage: pricingTier.maxUsage,
        pricePerEvent: pricingTier.pricePerEvent,
        effectiveDate: pricingTier.effectiveDate,
        isActive: pricingTier.isActive,
      }
    );
  }

  /**
   * Get all active pricing tiers
   */
  static async getActivePricingTiers(): Promise<PricingTier[]> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        FilterExpression: "isActive = :active",
        ExpressionAttributeValues: {
          ":pk": "PRICING",
          ":active": true,
        },
      })
    );

    return (response.Items as PricingConfigItem[]).map((item) => ({
      tierId: item.SK.replace("TIER#", ""),
      name: item.name,
      minUsage: item.minUsage,
      maxUsage: item.maxUsage,
      pricePerEvent: item.pricePerEvent,
      effectiveDate: item.effectiveDate,
      isActive: item.isActive,
    }));
  }

  /**
   * Get pricing tier for a specific usage amount
   */
  static async getPricingTierForUsage(
    usageCount: number
  ): Promise<PricingTier | null> {
    const tiers = await this.getActivePricingTiers();

    // Sort by minUsage ascending to find the appropriate tier
    tiers.sort((a, b) => a.minUsage - b.minUsage);

    for (const tier of tiers) {
      if (usageCount >= tier.minUsage && usageCount <= tier.maxUsage) {
        return tier;
      }
    }

    return null;
  }
}

/**
 * Utility functions for billing operations
 */
export class BillingUtils {
  /**
   * Generate a billing period string for the current month
   */
  static getCurrentBillingPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }

  /**
   * Generate a billing period string for a specific date
   */
  static getBillingPeriodForDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }

  /**
   * Generate a unique invoice ID
   */
  static generateInvoiceId(userId: string, billingPeriod: string): string {
    return `INV-${userId.substring(0, 8)}-${billingPeriod}-${Date.now()}`;
  }

  /**
   * Calculate due date (30 days from issue date)
   */
  static calculateDueDate(issueDate: string): string {
    const date = new Date(issueDate);
    date.setDate(date.getDate() + 30);
    return date.toISOString();
  }

  /**
   * Check if an invoice is overdue
   */
  static isInvoiceOverdue(dueDate: string): boolean {
    return new Date(dueDate) < new Date();
  }
}
