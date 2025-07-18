import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
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
} from "../types/billing";

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
  static async createUserAccount(userAccount: UserAccount): Promise<void> {
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
    updates: Partial<UserAccount>
  ): Promise<void> {
    const updateExpression: string[] = [];
    const expressionAttributeValues: Record<string, any> = {};
    const expressionAttributeNames: Record<string, string> = {};

    if (updates.billingPreferences) {
      updateExpression.push("billingPreferences = :billingPreferences");
      expressionAttributeValues[":billingPreferences"] =
        updates.billingPreferences;
    }

    if (updates.usageLimits) {
      updateExpression.push("usageLimits = :usageLimits");
      expressionAttributeValues[":usageLimits"] = updates.usageLimits;
    }

    if (updates.status) {
      updateExpression.push("#status = :status");
      expressionAttributeValues[":status"] = updates.status;
      expressionAttributeNames["#status"] = "status";
    }

    if (updates.email) {
      updateExpression.push("email = :email");
      expressionAttributeValues[":email"] = updates.email;
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
  }

  /**
   * Add payment method to user account
   */
  static async addPaymentMethod(
    userId: string,
    paymentMethod: PaymentMethod
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
}

/**
 * Invoices Operations
 */
export class InvoicesService {
  /**
   * Create a new invoice
   */
  static async createInvoice(invoice: Invoice): Promise<void> {
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
    paidDate?: string
  ): Promise<void> {
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
  }
}

/**
 * Pricing Configuration Operations
 */
export class PricingConfigService {
  /**
   * Create or update a pricing tier
   */
  static async setPricingTier(pricingTier: PricingTier): Promise<void> {
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
  }

  /**
   * Get all active pricing tiers
   */
  static async getActivePricingTiers(): Promise<PricingTier[]> {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "ActivePricingIndex",
        KeyConditionExpression: "isActive = :active",
        ExpressionAttributeValues: {
          ":active": "true",
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
