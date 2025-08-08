import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { UserAccountsService } from "../lib/utils/billingDatabase";
import { PaymentMethod } from "../lib/types/billing";
import {
  getStripe,
  createOrGetCustomer,
  attachPaymentMethodToCustomer,
  detachPaymentMethod,
  listCustomerPaymentMethods,
} from "../lib/utils/stripeService";

// Validation functions
const validatePaymentMethodData = (data: any): string[] => {
  const errors: string[] = [];

  if (!data.type || !["card", "bank_account"].includes(data.type)) {
    errors.push("Payment method type must be 'card' or 'bank_account'");
  }

  if (
    !data.last4 ||
    typeof data.last4 !== "string" ||
    data.last4.length !== 4
  ) {
    errors.push("Last 4 digits are required and must be 4 characters");
  }

  if (
    !data.stripePaymentMethodId ||
    typeof data.stripePaymentMethodId !== "string"
  ) {
    errors.push("Stripe payment method ID is required");
  }

  if (data.type === "card") {
    if (
      !data.expiryMonth ||
      typeof data.expiryMonth !== "number" ||
      data.expiryMonth < 1 ||
      data.expiryMonth > 12
    ) {
      errors.push("Valid expiry month (1-12) is required for cards");
    }

    if (
      !data.expiryYear ||
      typeof data.expiryYear !== "number" ||
      data.expiryYear < new Date().getFullYear()
    ) {
      errors.push("Valid expiry year is required for cards");
    }
  }

  if (data.isDefault !== undefined && typeof data.isDefault !== "boolean") {
    errors.push("isDefault must be a boolean value");
  }

  return errors;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": event.headers.origin || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };

  try {
    const method = event.requestContext.http.method;
    const pathParameters = event.pathParameters || {};

    if (!pathParameters.userId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User ID is required" }),
      };
    }

    const userId = pathParameters.userId;

    switch (method) {
      case "OPTIONS":
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: "",
        };

      case "POST":
        return await addPaymentMethod(event, userId, corsHeaders);

      case "GET":
        return await getPaymentMethods(userId, corsHeaders);

      case "PUT":
        if (pathParameters.paymentMethodId) {
          return await updatePaymentMethod(
            event,
            userId,
            pathParameters.paymentMethodId,
            corsHeaders
          );
        }
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Payment method ID required for updates",
          }),
        };

      case "DELETE":
        if (pathParameters.paymentMethodId) {
          return await removePaymentMethod(
            userId,
            pathParameters.paymentMethodId,
            corsHeaders
          );
        }
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "Payment method ID required for deletion",
          }),
        };

      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Method not allowed" }),
        };
    }
  } catch (error) {
    console.error("Error in payment method manager:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function addPaymentMethod(
  event: any,
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    const body = JSON.parse(event.body || "{}");
    console.log("Adding payment method for user:", userId, "with data:", body);

    // Validate that user exists
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Create or get Stripe customer
    const stripeCustomer = await createOrGetCustomer(
      userAccount.email,
      userId,
      userAccount.githubUsername
    );

    let stripePaymentMethod;

    // If stripePaymentMethodId is provided, attach existing payment method
    if (body.stripePaymentMethodId) {
      stripePaymentMethod = await attachPaymentMethodToCustomer(
        body.stripePaymentMethodId,
        stripeCustomer.id
      );
    } else {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Stripe payment method ID is required" }),
      };
    }

    // Extract payment method details from Stripe
    const paymentMethodType =
      stripePaymentMethod.type === "us_bank_account" ? "bank_account" : "card";
    let last4 = "";
    let expiryMonth: number | undefined;
    let expiryYear: number | undefined;

    if (stripePaymentMethod.card) {
      last4 = stripePaymentMethod.card.last4;
      expiryMonth = stripePaymentMethod.card.exp_month;
      expiryYear = stripePaymentMethod.card.exp_year;
    } else if (stripePaymentMethod.us_bank_account) {
      last4 = stripePaymentMethod.us_bank_account.last4 || "";
    }

    // If this is set as default, we need to unset other default payment methods
    if (body.isDefault) {
      const existingPaymentMethods =
        await UserAccountsService.getPaymentMethods(userId);
      for (const pm of existingPaymentMethods) {
        if (pm.isDefault) {
          // Update existing default to false
          const updatedPm: PaymentMethod = { ...pm, isDefault: false };
          await UserAccountsService.addPaymentMethod(userId, updatedPm);
        }
      }
    }

    const paymentMethodId = uuidv4();
    const paymentMethod: PaymentMethod = {
      paymentMethodId,
      type: paymentMethodType,
      last4,
      expiryMonth,
      expiryYear,
      isDefault: body.isDefault || false,
      stripePaymentMethodId: stripePaymentMethod.id,
      createdAt: new Date().toISOString(),
    };

    await UserAccountsService.addPaymentMethod(userId, paymentMethod);

    console.log("Payment method added successfully:", paymentMethodId);

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Payment method added successfully",
        paymentMethodId,
        paymentMethod: {
          ...paymentMethod,
          stripePaymentMethodId: undefined, // Don't expose Stripe ID in response
        },
      }),
    };
  } catch (error) {
    console.error("Error adding payment method:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to add payment method" }),
    };
  }
}

async function getPaymentMethods(
  userId: string,
  corsHeaders: Record<string, string>
) {
  try {
    console.log("Getting payment methods for user:", userId);

    // Validate that user exists
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    const paymentMethods = await UserAccountsService.getPaymentMethods(userId);

    // Remove sensitive Stripe information from response
    const sanitizedPaymentMethods = paymentMethods.map((pm) => ({
      ...pm,
      stripePaymentMethodId: undefined,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ paymentMethods: sanitizedPaymentMethods }),
    };
  } catch (error) {
    console.error("Error getting payment methods:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to retrieve payment methods" }),
    };
  }
}

async function updatePaymentMethod(
  event: any,
  userId: string,
  paymentMethodId: string,
  corsHeaders: Record<string, string>
) {
  try {
    const body = JSON.parse(event.body || "{}");
    console.log(
      "Updating payment method:",
      paymentMethodId,
      "for user:",
      userId
    );

    // Validate that user exists
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Get existing payment methods to find the one to update
    const existingPaymentMethods = await UserAccountsService.getPaymentMethods(
      userId
    );
    const existingPaymentMethod = existingPaymentMethods.find(
      (pm) => pm.paymentMethodId === paymentMethodId
    );

    if (!existingPaymentMethod) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Payment method not found" }),
      };
    }

    // Only allow updating isDefault flag for now
    if (body.isDefault !== undefined) {
      if (typeof body.isDefault !== "boolean") {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "isDefault must be a boolean value" }),
        };
      }

      // If setting as default, unset other defaults
      if (body.isDefault) {
        for (const pm of existingPaymentMethods) {
          if (pm.isDefault && pm.paymentMethodId !== paymentMethodId) {
            const updatedPm: PaymentMethod = { ...pm, isDefault: false };
            await UserAccountsService.addPaymentMethod(userId, updatedPm);
          }
        }
      }

      // Update the target payment method
      const updatedPaymentMethod: PaymentMethod = {
        ...existingPaymentMethod,
        isDefault: body.isDefault,
      };

      await UserAccountsService.addPaymentMethod(userId, updatedPaymentMethod);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Payment method updated successfully",
        }),
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "No valid updates provided" }),
    };
  } catch (error) {
    console.error("Error updating payment method:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to update payment method" }),
    };
  }
}

async function removePaymentMethod(
  userId: string,
  paymentMethodId: string,
  corsHeaders: Record<string, string>
) {
  try {
    console.log(
      "Removing payment method:",
      paymentMethodId,
      "for user:",
      userId
    );

    // Validate that user exists
    const userAccount = await UserAccountsService.getUserAccount(userId);
    if (!userAccount) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not found" }),
      };
    }

    // Get existing payment methods
    const existingPaymentMethods = await UserAccountsService.getPaymentMethods(
      userId
    );
    const paymentMethodToRemove = existingPaymentMethods.find(
      (pm) => pm.paymentMethodId === paymentMethodId
    );

    if (!paymentMethodToRemove) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Payment method not found" }),
      };
    }

    // Check if this is the only payment method
    if (existingPaymentMethods.length === 1) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error:
            "Cannot remove the only payment method. Add another payment method first.",
        }),
      };
    }

    // If removing the default payment method, set another one as default
    if (paymentMethodToRemove.isDefault) {
      const otherPaymentMethod = existingPaymentMethods.find(
        (pm) => pm.paymentMethodId !== paymentMethodId
      );
      if (otherPaymentMethod) {
        const updatedPm: PaymentMethod = {
          ...otherPaymentMethod,
          isDefault: true,
        };
        await UserAccountsService.addPaymentMethod(userId, updatedPm);
      }
    }

    // Detach payment method from Stripe
    try {
      await detachPaymentMethod(paymentMethodToRemove.stripePaymentMethodId);
    } catch (stripeError) {
      console.error("Error detaching payment method from Stripe:", stripeError);
      // Continue with local deletion even if Stripe fails
    }

    // Delete from database
    await UserAccountsService.deletePaymentMethod(userId, paymentMethodId);

    console.log("Payment method removed successfully:", paymentMethodId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Payment method removed successfully",
      }),
    };
  } catch (error) {
    console.error("Error removing payment method:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to remove payment method" }),
    };
  }
}
