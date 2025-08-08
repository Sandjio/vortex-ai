import { APIGatewayProxyHandlerV2, ScheduledHandler } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  UserAccountsService,
  InvoicesService,
} from "../lib/utils/billingDatabase";
import { Invoice, PaymentAttempt } from "../lib/types/billing";
import {
  getStripe,
  createOrGetCustomer,
  createPaymentIntent,
  confirmPaymentIntent,
  getPaymentIntent,
  handleFailedPayment,
} from "../lib/utils/stripeService";

/**
 * Process payment for a specific invoice
 */
export const processInvoicePayment: APIGatewayProxyHandlerV2 = async (
  event
) => {
  console.log("Processing invoice payment:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  try {
    if (event.requestContext.http.method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    const pathParameters = event.pathParameters || {};
    const { userId, billingPeriod } = pathParameters;

    if (!userId || !billingPeriod) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "User ID and billing period are required",
        }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { paymentMethodId } = body;

    if (!paymentMethodId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Payment method ID is required" }),
      };
    }

    // Get user account and invoice
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    const invoice = await InvoicesService.getInvoice(userId, billingPeriod);
    if (!invoice) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invoice not found" }),
      };
    }

    if (invoice.status === "paid") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invoice is already paid" }),
      };
    }

    // Get payment method
    const paymentMethods = await UserAccountsService.getPaymentMethods(userId);
    const paymentMethod = paymentMethods.find(
      (pm) => pm.paymentMethodId === paymentMethodId
    );

    if (!paymentMethod) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Payment method not found" }),
      };
    }

    // Create or get Stripe customer
    const stripeCustomer = await createOrGetCustomer(
      userAccount.email,
      userId,
      userAccount.githubUsername
    );

    // Create payment intent
    const paymentIntent = await createPaymentIntent(
      invoice.totalAmount,
      userAccount.billingPreferences.currency || "usd",
      stripeCustomer.id,
      paymentMethod.stripePaymentMethodId,
      invoice.invoiceId
    );

    // Record payment attempt
    const paymentAttempt: PaymentAttempt = {
      attemptId: uuidv4(),
      timestamp: new Date().toISOString(),
      amount: invoice.totalAmount,
      status: "pending",
      stripePaymentIntentId: paymentIntent.id,
    };

    // Update invoice with payment attempt
    const updatedInvoice: Invoice = {
      ...invoice,
      paymentAttempts: [...invoice.paymentAttempts, paymentAttempt],
    };

    await InvoicesService.createInvoice(updatedInvoice);

    // Handle payment intent status
    if (paymentIntent.status === "succeeded") {
      // Payment succeeded immediately
      await handleSuccessfulPayment(userId, billingPeriod, paymentIntent.id);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Payment processed successfully",
          status: "succeeded",
          paymentIntentId: paymentIntent.id,
        }),
      };
    } else if (paymentIntent.status === "requires_action") {
      // Payment requires additional action (3D Secure, etc.)
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Payment requires additional action",
          status: "requires_action",
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
        }),
      };
    } else {
      // Payment failed or requires payment method
      await handleFailedPaymentAttempt(
        userId,
        billingPeriod,
        paymentIntent.id,
        "Payment failed"
      );

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Payment failed",
          status: paymentIntent.status,
          error: paymentIntent.last_payment_error?.message || "Unknown error",
        }),
      };
    }
  } catch (error) {
    console.error("Error processing payment:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to process payment" }),
    };
  }
};

/**
 * Confirm payment intent (for 3D Secure flows)
 */
export const confirmPayment: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Confirming payment:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  try {
    if (event.requestContext.http.method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { paymentIntentId } = body;

    if (!paymentIntentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Payment intent ID is required" }),
      };
    }

    // Confirm payment intent
    const paymentIntent = await confirmPaymentIntent(paymentIntentId);

    if (paymentIntent.status === "succeeded") {
      // Extract invoice ID from metadata
      const invoiceId = paymentIntent.metadata?.invoiceId;
      const userId = paymentIntent.metadata?.userId;

      if (invoiceId && userId) {
        // Find invoice by ID and update status
        const userInvoices = await InvoicesService.getUserInvoices(userId);
        const invoice = userInvoices.find((inv) => inv.invoiceId === invoiceId);

        if (invoice) {
          await handleSuccessfulPayment(
            userId,
            invoice.billingPeriod,
            paymentIntentId
          );
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Payment confirmed successfully",
          status: "succeeded",
        }),
      };
    } else {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Payment confirmation failed",
          status: paymentIntent.status,
          error: paymentIntent.last_payment_error?.message || "Unknown error",
        }),
      };
    }
  } catch (error) {
    console.error("Error confirming payment:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to confirm payment" }),
    };
  }
};

/**
 * Scheduled function to retry failed payments
 */
export const retryFailedPayments: ScheduledHandler = async (event) => {
  console.log("Retrying failed payments:", JSON.stringify(event, null, 2));

  try {
    // This would typically query for invoices with failed payments that are eligible for retry
    // For now, we'll implement a basic structure

    console.log("Failed payment retry job completed");
  } catch (error) {
    console.error("Error in retry failed payments job:", error);
    throw error;
  }
};

/**
 * Handle successful payment
 */
async function handleSuccessfulPayment(
  userId: string,
  billingPeriod: string,
  paymentIntentId: string
): Promise<void> {
  try {
    // Get current invoice
    const invoice = await InvoicesService.getInvoice(userId, billingPeriod);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    // Update payment attempt status
    const updatedPaymentAttempts = invoice.paymentAttempts.map((attempt) => {
      if (attempt.stripePaymentIntentId === paymentIntentId) {
        return {
          ...attempt,
          status: "succeeded" as const,
        };
      }
      return attempt;
    });

    // Update invoice status
    await InvoicesService.updateInvoiceStatus(
      userId,
      billingPeriod,
      "paid",
      new Date().toISOString()
    );

    // Update invoice with successful payment attempt
    const updatedInvoice: Invoice = {
      ...invoice,
      status: "paid",
      paidDate: new Date().toISOString(),
      paymentAttempts: updatedPaymentAttempts,
    };

    await InvoicesService.createInvoice(updatedInvoice);

    console.log(`Payment successful for invoice ${invoice.invoiceId}`);
  } catch (error) {
    console.error("Error handling successful payment:", error);
    throw error;
  }
}

/**
 * Handle failed payment attempt
 */
async function handleFailedPaymentAttempt(
  userId: string,
  billingPeriod: string,
  paymentIntentId: string,
  failureReason: string
): Promise<void> {
  try {
    // Get current invoice
    const invoice = await InvoicesService.getInvoice(userId, billingPeriod);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    // Update payment attempt status
    const updatedPaymentAttempts = invoice.paymentAttempts.map((attempt) => {
      if (attempt.stripePaymentIntentId === paymentIntentId) {
        return {
          ...attempt,
          status: "failed" as const,
          failureReason,
        };
      }
      return attempt;
    });

    // Check if we should retry
    const failedAttempts = updatedPaymentAttempts.filter(
      (attempt) => attempt.status === "failed"
    ).length;
    const shouldRetry = failedAttempts < 3;

    // Update invoice status
    const newStatus = shouldRetry ? "pending" : "failed";
    await InvoicesService.updateInvoiceStatus(userId, billingPeriod, newStatus);

    // Update invoice with failed payment attempt
    const updatedInvoice: Invoice = {
      ...invoice,
      status: newStatus,
      paymentAttempts: updatedPaymentAttempts,
    };

    await InvoicesService.createInvoice(updatedInvoice);

    console.log(
      `Payment failed for invoice ${invoice.invoiceId}, retry: ${shouldRetry}`
    );
  } catch (error) {
    console.error("Error handling failed payment:", error);
    throw error;
  }
}

/**
 * Get payment status for an invoice
 */
export const getPaymentStatus: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Getting payment status:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  try {
    if (event.requestContext.http.method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    const pathParameters = event.pathParameters || {};
    const { userId, billingPeriod } = pathParameters;

    if (!userId || !billingPeriod) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "User ID and billing period are required",
        }),
      };
    }

    // Get invoice
    const invoice = await InvoicesService.getInvoice(userId, billingPeriod);
    if (!invoice) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invoice not found" }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        invoiceId: invoice.invoiceId,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        paidDate: invoice.paidDate,
        paymentAttempts: invoice.paymentAttempts.map((attempt) => ({
          attemptId: attempt.attemptId,
          timestamp: attempt.timestamp,
          amount: attempt.amount,
          status: attempt.status,
          failureReason: attempt.failureReason,
        })),
      }),
    };
  } catch (error) {
    console.error("Error getting payment status:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to get payment status" }),
    };
  }
};
