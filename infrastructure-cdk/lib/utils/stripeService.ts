import Stripe from "stripe";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let stripeInstance: Stripe | null = null;
let stripeSecretKey: string | null = null;

const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

/**
 * Initialize Stripe SDK with secret key from AWS Secrets Manager
 */
async function initializeStripe(): Promise<Stripe> {
  if (stripeInstance && stripeSecretKey) {
    return stripeInstance;
  }

  try {
    // Get Stripe secret key from AWS Secrets Manager
    const secretName = process.env.STRIPE_SECRET_NAME || "stripe-secret-key";
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await secretsManager.send(command);

    if (!response.SecretString) {
      throw new Error("Stripe secret key not found in Secrets Manager");
    }

    const secretData = JSON.parse(response.SecretString);
    stripeSecretKey = secretData.stripe_secret_key;

    if (!stripeSecretKey) {
      throw new Error("stripe_secret_key not found in secret data");
    }

    stripeInstance = new Stripe(stripeSecretKey, {
      apiVersion: "2024-10-28.acacia",
      typescript: true,
    });

    console.log("Stripe SDK initialized successfully");
    return stripeInstance;
  } catch (error) {
    console.error("Failed to initialize Stripe SDK:", error);
    throw new Error("Stripe initialization failed");
  }
}

/**
 * Get initialized Stripe instance
 */
export async function getStripe(): Promise<Stripe> {
  return await initializeStripe();
}

/**
 * Create a payment method in Stripe
 */
export async function createPaymentMethod(
  type: "card" | "us_bank_account",
  paymentDetails: any,
  customerId?: string
): Promise<Stripe.PaymentMethod> {
  const stripe = await getStripe();

  const paymentMethodData: Stripe.PaymentMethodCreateParams = {
    type,
    ...paymentDetails,
  };

  if (customerId) {
    paymentMethodData.customer = customerId;
  }

  return await stripe.paymentMethods.create(paymentMethodData);
}

/**
 * Attach payment method to customer
 */
export async function attachPaymentMethodToCustomer(
  paymentMethodId: string,
  customerId: string
): Promise<Stripe.PaymentMethod> {
  const stripe = await getStripe();

  return await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });
}

/**
 * Detach payment method from customer
 */
export async function detachPaymentMethod(
  paymentMethodId: string
): Promise<Stripe.PaymentMethod> {
  const stripe = await getStripe();

  return await stripe.paymentMethods.detach(paymentMethodId);
}

/**
 * Create or retrieve Stripe customer
 */
export async function createOrGetCustomer(
  email: string,
  userId: string,
  githubUsername: string
): Promise<Stripe.Customer> {
  const stripe = await getStripe();

  // First, try to find existing customer by metadata
  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create new customer
  return await stripe.customers.create({
    email,
    metadata: {
      userId,
      githubUsername,
    },
    description: `Vortex AI user: ${githubUsername}`,
  });
}

/**
 * Create payment intent for invoice payment
 */
export async function createPaymentIntent(
  amount: number,
  currency: string,
  customerId: string,
  paymentMethodId: string,
  invoiceId: string
): Promise<Stripe.PaymentIntent> {
  const stripe = await getStripe();

  return await stripe.paymentIntents.create({
    amount: Math.round(amount * 100), // Convert to cents
    currency: currency.toLowerCase(),
    customer: customerId,
    payment_method: paymentMethodId,
    confirmation_method: "manual",
    confirm: true,
    return_url:
      process.env.STRIPE_RETURN_URL || "https://vortex-ai.com/billing",
    metadata: {
      invoiceId,
      userId: customerId,
    },
  });
}

/**
 * Confirm payment intent
 */
export async function confirmPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const stripe = await getStripe();

  return await stripe.paymentIntents.confirm(paymentIntentId);
}

/**
 * Retrieve payment intent
 */
export async function getPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const stripe = await getStripe();

  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * List customer payment methods
 */
export async function listCustomerPaymentMethods(
  customerId: string,
  type?: "card" | "us_bank_account"
): Promise<Stripe.PaymentMethod[]> {
  const stripe = await getStripe();

  const params: Stripe.PaymentMethodListParams = {
    customer: customerId,
    limit: 100,
  };

  if (type) {
    params.type = type;
  }

  const response = await stripe.paymentMethods.list(params);
  return response.data;
}

/**
 * Update payment method
 */
export async function updatePaymentMethod(
  paymentMethodId: string,
  updates: Stripe.PaymentMethodUpdateParams
): Promise<Stripe.PaymentMethod> {
  const stripe = await getStripe();

  return await stripe.paymentMethods.update(paymentMethodId, updates);
}

/**
 * Construct webhook event from request
 */
export async function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  endpointSecret: string
): Promise<Stripe.Event> {
  const stripe = await getStripe();

  return stripe.webhooks.constructEvent(payload, signature, endpointSecret);
}

/**
 * Handle failed payment with retry logic
 */
export async function handleFailedPayment(
  paymentIntentId: string,
  customerId: string
): Promise<{ shouldRetry: boolean; nextRetryDate?: Date }> {
  const stripe = await getStripe();

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "requires_payment_method") {
      // Payment method failed, need new payment method
      return { shouldRetry: false };
    }

    if (paymentIntent.status === "requires_action") {
      // Requires customer action (3D Secure, etc.)
      return { shouldRetry: false };
    }

    // For other failures, implement retry logic
    const retryCount = parseInt(paymentIntent.metadata?.retryCount || "0");
    if (retryCount < 3) {
      const nextRetryDate = new Date();
      nextRetryDate.setDate(nextRetryDate.getDate() + Math.pow(2, retryCount)); // Exponential backoff

      return { shouldRetry: true, nextRetryDate };
    }

    return { shouldRetry: false };
  } catch (error) {
    console.error("Error handling failed payment:", error);
    return { shouldRetry: false };
  }
}
