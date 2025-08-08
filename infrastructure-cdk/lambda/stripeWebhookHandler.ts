import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { constructWebhookEvent } from "../lib/utils/stripeService";
import {
  UserAccountsService,
  InvoicesService,
} from "../lib/utils/billingDatabase";
import { Invoice } from "../lib/types/billing";

/**
 * Handle Stripe webhook events
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Stripe webhook received:", JSON.stringify(event, null, 2));

  try {
    const signature = event.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !endpointSecret) {
      console.error("Missing Stripe signature or webhook secret");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required headers" }),
      };
    }

    // Construct webhook event
    const stripeEvent = await constructWebhookEvent(
      event.body || "",
      signature,
      endpointSecret
    );

    console.log("Webhook event type:", stripeEvent.type);

    // Handle different event types
    switch (stripeEvent.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(stripeEvent);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(stripeEvent);
        break;

      case "payment_intent.requires_action":
        await handlePaymentIntentRequiresAction(stripeEvent);
        break;

      case "payment_method.attached":
        await handlePaymentMethodAttached(stripeEvent);
        break;

      case "payment_method.detached":
        await handlePaymentMethodDetached(stripeEvent);
        break;

      case "customer.created":
        await handleCustomerCreated(stripeEvent);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(stripeEvent);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(stripeEvent);
        break;

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    console.error("Error processing webhook:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Webhook processing failed" }),
    };
  }
};

/**
 * Handle successful payment intent
 */
async function handlePaymentIntentSucceeded(event: any): Promise<void> {
  try {
    const paymentIntent = event.data.object;
    const invoiceId = paymentIntent.metadata?.invoiceId;
    const userId = paymentIntent.metadata?.userId;

    if (!invoiceId || !userId) {
      console.log("Missing invoice ID or user ID in payment intent metadata");
      return;
    }

    console.log(`Payment succeeded for invoice ${invoiceId}, user ${userId}`);

    // Find the invoice by user and invoice ID
    const userInvoices = await InvoicesService.getUserInvoices(userId);
    const invoice = userInvoices.find((inv) => inv.invoiceId === invoiceId);

    if (!invoice) {
      console.error(`Invoice ${invoiceId} not found for user ${userId}`);
      return;
    }

    // Update payment attempt status
    const updatedPaymentAttempts = invoice.paymentAttempts.map((attempt) => {
      if (attempt.stripePaymentIntentId === paymentIntent.id) {
        return {
          ...attempt,
          status: "succeeded" as const,
        };
      }
      return attempt;
    });

    // Update invoice status to paid
    await InvoicesService.updateInvoiceStatus(
      userId,
      invoice.billingPeriod,
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

    console.log(`Invoice ${invoiceId} marked as paid`);
  } catch (error) {
    console.error("Error handling payment intent succeeded:", error);
    throw error;
  }
}

/**
 * Handle failed payment intent
 */
async function handlePaymentIntentFailed(event: any): Promise<void> {
  try {
    const paymentIntent = event.data.object;
    const invoiceId = paymentIntent.metadata?.invoiceId;
    const userId = paymentIntent.metadata?.userId;

    if (!invoiceId || !userId) {
      console.log("Missing invoice ID or user ID in payment intent metadata");
      return;
    }

    console.log(`Payment failed for invoice ${invoiceId}, user ${userId}`);

    // Find the invoice by user and invoice ID
    const userInvoices = await InvoicesService.getUserInvoices(userId);
    const invoice = userInvoices.find((inv) => inv.invoiceId === invoiceId);

    if (!invoice) {
      console.error(`Invoice ${invoiceId} not found for user ${userId}`);
      return;
    }

    const failureReason =
      paymentIntent.last_payment_error?.message || "Payment failed";

    // Update payment attempt status
    const updatedPaymentAttempts = invoice.paymentAttempts.map((attempt) => {
      if (attempt.stripePaymentIntentId === paymentIntent.id) {
        return {
          ...attempt,
          status: "failed" as const,
          failureReason,
        };
      }
      return attempt;
    });

    // Check if we should retry (less than 3 failed attempts)
    const failedAttempts = updatedPaymentAttempts.filter(
      (attempt) => attempt.status === "failed"
    ).length;
    const shouldRetry = failedAttempts < 3;

    // Update invoice status
    const newStatus = shouldRetry ? "pending" : "failed";
    await InvoicesService.updateInvoiceStatus(
      userId,
      invoice.billingPeriod,
      newStatus
    );

    // Update invoice with failed payment attempt
    const updatedInvoice: Invoice = {
      ...invoice,
      status: newStatus,
      paymentAttempts: updatedPaymentAttempts,
    };

    await InvoicesService.createInvoice(updatedInvoice);

    console.log(`Invoice ${invoiceId} payment failed, retry: ${shouldRetry}`);
  } catch (error) {
    console.error("Error handling payment intent failed:", error);
    throw error;
  }
}

/**
 * Handle payment intent that requires action
 */
async function handlePaymentIntentRequiresAction(event: any): Promise<void> {
  try {
    const paymentIntent = event.data.object;
    const invoiceId = paymentIntent.metadata?.invoiceId;
    const userId = paymentIntent.metadata?.userId;

    if (!invoiceId || !userId) {
      console.log("Missing invoice ID or user ID in payment intent metadata");
      return;
    }

    console.log(
      `Payment requires action for invoice ${invoiceId}, user ${userId}`
    );

    // Find the invoice by user and invoice ID
    const userInvoices = await InvoicesService.getUserInvoices(userId);
    const invoice = userInvoices.find((inv) => inv.invoiceId === invoiceId);

    if (!invoice) {
      console.error(`Invoice ${invoiceId} not found for user ${userId}`);
      return;
    }

    // Update payment attempt status to pending (waiting for user action)
    const updatedPaymentAttempts = invoice.paymentAttempts.map((attempt) => {
      if (attempt.stripePaymentIntentId === paymentIntent.id) {
        return {
          ...attempt,
          status: "pending" as const,
        };
      }
      return attempt;
    });

    // Update invoice with pending payment attempt
    const updatedInvoice: Invoice = {
      ...invoice,
      paymentAttempts: updatedPaymentAttempts,
    };

    await InvoicesService.createInvoice(updatedInvoice);

    console.log(`Invoice ${invoiceId} payment requires user action`);
  } catch (error) {
    console.error("Error handling payment intent requires action:", error);
    throw error;
  }
}

/**
 * Handle payment method attached to customer
 */
async function handlePaymentMethodAttached(event: any): Promise<void> {
  try {
    const paymentMethod = event.data.object;
    const customerId = paymentMethod.customer;

    console.log(
      `Payment method ${paymentMethod.id} attached to customer ${customerId}`
    );

    // This event is mainly for logging/auditing purposes
    // The actual payment method management is handled in the payment method manager
  } catch (error) {
    console.error("Error handling payment method attached:", error);
    throw error;
  }
}

/**
 * Handle payment method detached from customer
 */
async function handlePaymentMethodDetached(event: any): Promise<void> {
  try {
    const paymentMethod = event.data.object;

    console.log(`Payment method ${paymentMethod.id} detached`);

    // This event is mainly for logging/auditing purposes
    // The actual payment method management is handled in the payment method manager
  } catch (error) {
    console.error("Error handling payment method detached:", error);
    throw error;
  }
}

/**
 * Handle customer created
 */
async function handleCustomerCreated(event: any): Promise<void> {
  try {
    const customer = event.data.object;
    const userId = customer.metadata?.userId;
    const githubUsername = customer.metadata?.githubUsername;

    console.log(
      `Customer created: ${customer.id} for user ${userId} (${githubUsername})`
    );

    // This event is mainly for logging/auditing purposes
    // Customer creation is handled in the Stripe service
  } catch (error) {
    console.error("Error handling customer created:", error);
    throw error;
  }
}

/**
 * Handle invoice payment succeeded (for Stripe-generated invoices)
 */
async function handleInvoicePaymentSucceeded(event: any): Promise<void> {
  try {
    const invoice = event.data.object;
    const customerId = invoice.customer;

    console.log(
      `Invoice payment succeeded: ${invoice.id} for customer ${customerId}`
    );

    // This would be used if we were using Stripe's invoice system
    // Currently we're managing invoices in our own system
  } catch (error) {
    console.error("Error handling invoice payment succeeded:", error);
    throw error;
  }
}

/**
 * Handle invoice payment failed (for Stripe-generated invoices)
 */
async function handleInvoicePaymentFailed(event: any): Promise<void> {
  try {
    const invoice = event.data.object;
    const customerId = invoice.customer;

    console.log(
      `Invoice payment failed: ${invoice.id} for customer ${customerId}`
    );

    // This would be used if we were using Stripe's invoice system
    // Currently we're managing invoices in our own system
  } catch (error) {
    console.error("Error handling invoice payment failed:", error);
    throw error;
  }
}
