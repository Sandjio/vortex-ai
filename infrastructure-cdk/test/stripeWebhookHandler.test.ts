import { jest } from "@jest/globals";
import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { handler } from "../lambda/stripeWebhookHandler";

// Mock context
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: "test-function",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:test-function",
  memoryLimitInMB: "128",
  awsRequestId: "test-request-id",
  logGroupName: "/aws/lambda/test-function",
  logStreamName: "test-stream",
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

// Mock dependencies
const mockStripeService = {
  constructWebhookEvent: jest.fn() as jest.MockedFunction<any>,
};

const mockUserAccountsService = {
  getUserAccount: jest.fn() as jest.MockedFunction<any>,
};

const mockInvoicesService = {
  getUserInvoices: jest.fn() as jest.MockedFunction<any>,
  createInvoice: jest.fn() as jest.MockedFunction<any>,
  updateInvoiceStatus: jest.fn() as jest.MockedFunction<any>,
};

jest.mock("../lib/utils/stripeService", () => mockStripeService);
jest.mock("../lib/utils/billingDatabase", () => ({
  UserAccountsService: mockUserAccountsService,
  InvoicesService: mockInvoicesService,
}));

describe("StripeWebhookHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test123";
  });

  const mockEvent: Partial<APIGatewayProxyEventV2> = {
    headers: {
      "stripe-signature": "t=1234567890,v1=signature",
    },
    body: JSON.stringify({
      id: "evt_test123",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test123",
          status: "succeeded",
          metadata: {
            invoiceId: "inv123",
            userId: "user123",
          },
        },
      },
    }),
  };

  const mockInvoice = {
    invoiceId: "inv123",
    userId: "user123",
    billingPeriod: "2024-01",
    status: "pending" as const,
    paymentAttempts: [
      {
        attemptId: "attempt123",
        timestamp: "2024-01-15T00:00:00Z",
        amount: 25.5,
        status: "pending" as const,
        stripePaymentIntentId: "pi_test123",
      },
    ],
  };

  it("should handle payment_intent.succeeded event", async () => {
    const stripeEvent = {
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test123",
          status: "succeeded",
          metadata: {
            invoiceId: "inv123",
            userId: "user123",
          },
        },
      },
    };

    mockStripeService.constructWebhookEvent.mockResolvedValue(stripeEvent);
    mockInvoicesService.getUserInvoices.mockResolvedValue([mockInvoice]);

    const result = await handler(
      mockEvent as APIGatewayProxyEventV2,
      mockContext
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ received: true });
    expect(mockInvoicesService.updateInvoiceStatus).toHaveBeenCalledWith(
      "user123",
      "2024-01",
      "paid",
      expect.any(String)
    );
  });

  it("should handle payment_intent.payment_failed event", async () => {
    const stripeEvent = {
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_test123",
          status: "requires_payment_method",
          metadata: {
            invoiceId: "inv123",
            userId: "user123",
          },
          last_payment_error: {
            message: "Your card was declined.",
          },
        },
      },
    };

    mockStripeService.constructWebhookEvent.mockResolvedValue(stripeEvent);
    mockInvoicesService.getUserInvoices.mockResolvedValue([mockInvoice]);

    const result = await handler(
      mockEvent as APIGatewayProxyEventV2,
      mockContext
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ received: true });
    expect(mockInvoicesService.updateInvoiceStatus).toHaveBeenCalledWith(
      "user123",
      "2024-01",
      "pending"
    );
  });

  it("should handle unrecognized event types", async () => {
    const stripeEvent = {
      type: "unknown.event",
      data: {
        object: {},
      },
    };

    mockStripeService.constructWebhookEvent.mockResolvedValue(stripeEvent);

    const result = await handler(
      mockEvent as APIGatewayProxyEventV2,
      mockContext
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ received: true });
  });

  it("should return 400 if signature is missing", async () => {
    const eventWithoutSignature = {
      ...mockEvent,
      headers: {},
    };

    const result = await handler(
      eventWithoutSignature as APIGatewayProxyEventV2,
      mockContext
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({
      error: "Missing required headers",
    });
  });

  it("should handle webhook construction errors", async () => {
    mockStripeService.constructWebhookEvent.mockRejectedValue(
      new Error("Invalid signature")
    );

    const result = await handler(
      mockEvent as APIGatewayProxyEventV2,
      mockContext
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({
      error: "Webhook processing failed",
    });
  });
});
