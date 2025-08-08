import { jest } from "@jest/globals";
import {
  getStripe,
  createOrGetCustomer,
  createPaymentIntent,
  confirmPaymentIntent,
  attachPaymentMethodToCustomer,
  detachPaymentMethod,
  constructWebhookEvent,
  handleFailedPayment,
} from "../lib/utils/stripeService";

// Mock AWS SDK
const mockSecretsManager = {
  send: jest.fn(),
};

jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn(() => mockSecretsManager),
  GetSecretValueCommand: jest.fn(),
}));

// Mock Stripe
const mockStripe = {
  customers: {
    list: jest.fn(),
    create: jest.fn(),
  },
  paymentMethods: {
    create: jest.fn(),
    attach: jest.fn(),
    detach: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
  },
  paymentIntents: {
    create: jest.fn(),
    confirm: jest.fn(),
    retrieve: jest.fn(),
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
};

jest.mock("stripe", () => {
  return jest.fn(() => mockStripe);
});

describe("StripeService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_NAME = "test-stripe-secret";
    process.env.AWS_REGION = "us-east-1";
  });

  describe("getStripe", () => {
    it("should initialize Stripe SDK successfully", async () => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });

      const stripe = await getStripe();
      expect(stripe).toBeDefined();
    });

    it("should throw error if secret is not found", async () => {
      mockSecretsManager.send.mockRejectedValue(new Error("Secret not found"));

      await expect(getStripe()).rejects.toThrow("Stripe initialization failed");
    });

    it("should throw error if secret string is missing", async () => {
      mockSecretsManager.send.mockResolvedValue({});

      await expect(getStripe()).rejects.toThrow("Stripe initialization failed");
    });

    it("should throw error if stripe_secret_key is missing from secret", async () => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          other_key: "value",
        }),
      });

      await expect(getStripe()).rejects.toThrow("Stripe initialization failed");
    });
  });

  describe("createOrGetCustomer", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should return existing customer if found", async () => {
      const existingCustomer = {
        id: "cus_existing123",
        email: "test@example.com",
      };

      mockStripe.customers.list.mockResolvedValue({
        data: [existingCustomer],
      });

      const result = await createOrGetCustomer(
        "test@example.com",
        "user123",
        "testuser"
      );

      expect(result).toEqual(existingCustomer);
      expect(mockStripe.customers.list).toHaveBeenCalledWith({
        email: "test@example.com",
        limit: 1,
      });
    });

    it("should create new customer if not found", async () => {
      const newCustomer = {
        id: "cus_new123",
        email: "test@example.com",
      };

      mockStripe.customers.list.mockResolvedValue({
        data: [],
      });
      mockStripe.customers.create.mockResolvedValue(newCustomer);

      const result = await createOrGetCustomer(
        "test@example.com",
        "user123",
        "testuser"
      );

      expect(result).toEqual(newCustomer);
      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: "test@example.com",
        metadata: {
          userId: "user123",
          githubUsername: "testuser",
        },
        description: "Vortex AI user: testuser",
      });
    });
  });

  describe("createPaymentIntent", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should create payment intent successfully", async () => {
      const paymentIntent = {
        id: "pi_test123",
        status: "requires_confirmation",
        client_secret: "pi_test123_secret",
      };

      mockStripe.paymentIntents.create.mockResolvedValue(paymentIntent);

      const result = await createPaymentIntent(
        25.5,
        "usd",
        "cus_123",
        "pm_123",
        "inv_123"
      );

      expect(result).toEqual(paymentIntent);
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 2550, // 25.5 * 100
        currency: "usd",
        customer: "cus_123",
        payment_method: "pm_123",
        confirmation_method: "manual",
        confirm: true,
        return_url: expect.any(String),
        metadata: {
          invoiceId: "inv_123",
          userId: "cus_123",
        },
      });
    });
  });

  describe("confirmPaymentIntent", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should confirm payment intent successfully", async () => {
      const confirmedPaymentIntent = {
        id: "pi_test123",
        status: "succeeded",
      };

      mockStripe.paymentIntents.confirm.mockResolvedValue(
        confirmedPaymentIntent
      );

      const result = await confirmPaymentIntent("pi_test123");

      expect(result).toEqual(confirmedPaymentIntent);
      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(
        "pi_test123"
      );
    });
  });

  describe("attachPaymentMethodToCustomer", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should attach payment method to customer", async () => {
      const attachedPaymentMethod = {
        id: "pm_test123",
        customer: "cus_test123",
      };

      mockStripe.paymentMethods.attach.mockResolvedValue(attachedPaymentMethod);

      const result = await attachPaymentMethodToCustomer(
        "pm_test123",
        "cus_test123"
      );

      expect(result).toEqual(attachedPaymentMethod);
      expect(mockStripe.paymentMethods.attach).toHaveBeenCalledWith(
        "pm_test123",
        {
          customer: "cus_test123",
        }
      );
    });
  });

  describe("detachPaymentMethod", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should detach payment method", async () => {
      const detachedPaymentMethod = {
        id: "pm_test123",
        customer: null,
      };

      mockStripe.paymentMethods.detach.mockResolvedValue(detachedPaymentMethod);

      const result = await detachPaymentMethod("pm_test123");

      expect(result).toEqual(detachedPaymentMethod);
      expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith(
        "pm_test123"
      );
    });
  });

  describe("constructWebhookEvent", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should construct webhook event successfully", async () => {
      const webhookEvent = {
        id: "evt_test123",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_test123",
          },
        },
      };

      mockStripe.webhooks.constructEvent.mockReturnValue(webhookEvent);

      const result = await constructWebhookEvent(
        "webhook_payload",
        "signature",
        "webhook_secret"
      );

      expect(result).toEqual(webhookEvent);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        "webhook_payload",
        "signature",
        "webhook_secret"
      );
    });
  });

  describe("handleFailedPayment", () => {
    beforeEach(() => {
      mockSecretsManager.send.mockResolvedValue({
        SecretString: JSON.stringify({
          stripe_secret_key: "sk_test_123",
        }),
      });
    });

    it("should return no retry for requires_payment_method status", async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_test123",
        status: "requires_payment_method",
        metadata: {},
      });

      const result = await handleFailedPayment("pi_test123", "cus_test123");

      expect(result.shouldRetry).toBe(false);
      expect(result.nextRetryDate).toBeUndefined();
    });

    it("should return no retry for requires_action status", async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_test123",
        status: "requires_action",
        metadata: {},
      });

      const result = await handleFailedPayment("pi_test123", "cus_test123");

      expect(result.shouldRetry).toBe(false);
      expect(result.nextRetryDate).toBeUndefined();
    });

    it("should return retry with exponential backoff for other failures", async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_test123",
        status: "failed",
        metadata: {
          retryCount: "1",
        },
      });

      const result = await handleFailedPayment("pi_test123", "cus_test123");

      expect(result.shouldRetry).toBe(true);
      expect(result.nextRetryDate).toBeInstanceOf(Date);
    });

    it("should return no retry after max attempts", async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_test123",
        status: "failed",
        metadata: {
          retryCount: "3",
        },
      });

      const result = await handleFailedPayment("pi_test123", "cus_test123");

      expect(result.shouldRetry).toBe(false);
      expect(result.nextRetryDate).toBeUndefined();
    });

    it("should handle errors gracefully", async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValue(
        new Error("Payment intent not found")
      );

      const result = await handleFailedPayment("pi_test123", "cus_test123");

      expect(result.shouldRetry).toBe(false);
      expect(result.nextRetryDate).toBeUndefined();
    });
  });
});
