import { ScheduledEvent, Context } from "aws-lambda";
import {
  UsageRecordsService,
  UserAccountsService,
  InvoicesService,
  BillingUtils,
} from "../lib/utils/billingDatabase";
import { calculateBillingForUsage } from "./pricingManager";
import {
  Invoice,
  LineItem,
  BillingCalculation,
  UsageRecordItem,
} from "../lib/types/billing";

/**
 * Scheduled Lambda function for monthly billing processing
 * Triggered on the 1st of each month to process previous month's usage
 */
export const handler = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  console.log("Starting monthly billing processing", { event, context });

  try {
    // Calculate the billing period for the previous month
    const billingPeriod = getPreviousMonthBillingPeriod();
    console.log(`Processing billing for period: ${billingPeriod}`);

    // Get all usage records for the billing period
    const allUsageRecords = await UsageRecordsService.getAllUsageForPeriod(
      billingPeriod
    );
    console.log(
      `Found ${allUsageRecords.length} usage records for ${billingPeriod}`
    );

    // Group usage records by user
    const usageByUser = groupUsageByUser(allUsageRecords);
    console.log(
      `Processing billing for ${Object.keys(usageByUser).length} users`
    );

    // Process billing for each user
    const billingResults = await Promise.allSettled(
      Object.entries(usageByUser).map(([userId, userUsage]) =>
        processBillingForUser(userId, billingPeriod, userUsage)
      )
    );

    // Log results
    const successful = billingResults.filter(
      (r) => r.status === "fulfilled"
    ).length;
    const failed = billingResults.filter((r) => r.status === "rejected").length;

    console.log(
      `Billing processing completed: ${successful} successful, ${failed} failed`
    );

    // Log any failures
    billingResults.forEach((result, index) => {
      if (result.status === "rejected") {
        const userId = Object.keys(usageByUser)[index];
        console.error(
          `Failed to process billing for user ${userId}:`,
          result.reason
        );
      }
    });
  } catch (error) {
    console.error("Error in billing processor:", error);
    throw error;
  }
};

/**
 * Process billing for a single user
 */
async function processBillingForUser(
  userId: string,
  billingPeriod: string,
  usageRecords: UsageRecordItem[]
): Promise<void> {
  try {
    console.log(
      `Processing billing for user ${userId} with ${usageRecords.length} events`
    );

    // Check if invoice already exists for this period
    const existingInvoice = await InvoicesService.getInvoice(
      userId,
      billingPeriod
    );
    if (existingInvoice) {
      console.log(
        `Invoice already exists for user ${userId} period ${billingPeriod}`
      );
      return;
    }

    // Get user account to ensure they're active
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      console.warn(`User account not found for ${userId}, skipping billing`);
      return;
    }

    if (userAccount.status !== "active") {
      console.log(
        `User ${userId} is not active (${userAccount.status}), skipping billing`
      );
      return;
    }

    // Calculate billing for the user's usage
    const usageCount = usageRecords.length;
    const billingCalculation = await calculateBillingForUsage(
      userId,
      billingPeriod,
      usageCount
    );

    // Generate invoice if there are charges
    if (billingCalculation.totalAmount > 0) {
      const invoice = await generateInvoice(
        userId,
        billingPeriod,
        billingCalculation,
        usageRecords
      );

      // Save the invoice
      await InvoicesService.createInvoice(invoice);
      console.log(
        `Created invoice ${invoice.invoiceId} for user ${userId}: $${invoice.totalAmount}`
      );
    } else {
      console.log(`No charges for user ${userId} in period ${billingPeriod}`);
    }
  } catch (error) {
    console.error(`Error processing billing for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Generate an invoice from billing calculation
 */
async function generateInvoice(
  userId: string,
  billingPeriod: string,
  billingCalculation: BillingCalculation,
  usageRecords: UsageRecordItem[]
): Promise<Invoice> {
  const issueDate = new Date().toISOString();
  const dueDate = BillingUtils.calculateDueDate(issueDate);
  const invoiceId = BillingUtils.generateInvoiceId(userId, billingPeriod);

  // Create line items from billing breakdown
  const lineItems: LineItem[] = billingCalculation.breakdown.map(
    (breakdown) => ({
      description: `${breakdown.tier} - ${breakdown.eventCount} events`,
      quantity: breakdown.eventCount,
      unitPrice: breakdown.rate,
      amount: breakdown.amount,
      period: billingPeriod,
    })
  );

  // Add summary line item if multiple tiers
  if (lineItems.length > 1) {
    lineItems.push({
      description: `Total Usage - ${billingCalculation.usageCount} events`,
      quantity: billingCalculation.usageCount,
      unitPrice: billingCalculation.totalAmount / billingCalculation.usageCount,
      amount: billingCalculation.totalAmount,
      period: billingPeriod,
    });
  }

  const invoice: Invoice = {
    invoiceId,
    userId,
    billingPeriod,
    issueDate,
    dueDate,
    totalAmount: billingCalculation.totalAmount,
    status: "pending",
    lineItems,
    paymentAttempts: [],
  };

  return invoice;
}

/**
 * Group usage records by user ID
 */
function groupUsageByUser(
  usageRecords: UsageRecordItem[]
): Record<string, UsageRecordItem[]> {
  return usageRecords.reduce((acc, record) => {
    const userId = record.PK.replace("USER#", "");
    if (!acc[userId]) {
      acc[userId] = [];
    }
    acc[userId].push(record);
    return acc;
  }, {} as Record<string, UsageRecordItem[]>);
}

/**
 * Get the billing period for the previous month
 */
function getPreviousMonthBillingPeriod(): string {
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previousMonth.getFullYear()}-${String(
    previousMonth.getMonth() + 1
  ).padStart(2, "0")}`;
}

/**
 * Manual billing trigger for testing or reprocessing
 * Can be invoked directly with a specific billing period
 */
export const manualBillingHandler = async (event: {
  billingPeriod?: string;
  userId?: string;
}): Promise<void> => {
  console.log("Manual billing trigger", event);

  const billingPeriod = event.billingPeriod || getPreviousMonthBillingPeriod();

  if (event.userId) {
    // Process billing for a specific user
    const userUsage = await UsageRecordsService.getUserUsage(
      event.userId,
      billingPeriod
    );
    await processBillingForUser(event.userId, billingPeriod, userUsage);
  } else {
    // Process billing for all users
    const allUsageRecords = await UsageRecordsService.getAllUsageForPeriod(
      billingPeriod
    );
    const usageByUser = groupUsageByUser(allUsageRecords);

    await Promise.all(
      Object.entries(usageByUser).map(([userId, userUsage]) =>
        processBillingForUser(userId, billingPeriod, userUsage)
      )
    );
  }
};
