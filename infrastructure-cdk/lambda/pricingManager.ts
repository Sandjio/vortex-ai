import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PricingConfigService } from "../lib/utils/billingDatabase";
import {
  PricingTier,
  UsageBreakdown,
  BillingCalculation,
} from "../lib/types/billing";

/**
 * Lambda handler for pricing configuration management
 * Handles CRUD operations for pricing tiers and rate calculations
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  };

  try {
    const { httpMethod, pathParameters, body } = event;
    const path = event.resource;

    // Handle CORS preflight
    if (httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers,
        body: "",
      };
    }

    // Route to appropriate handler based on HTTP method and path
    switch (httpMethod) {
      case "GET":
        if (path === "/admin/pricing/tiers") {
          return await handleGetPricingTiers(headers);
        } else if (path === "/admin/pricing/calculate") {
          return await handleCalculatePricing(event, headers);
        }
        break;

      case "POST":
        if (path === "/admin/pricing/tiers") {
          return await handleCreatePricingTier(body, headers);
        }
        break;

      case "PUT":
        if (path === "/admin/pricing/tiers/{tierId}") {
          return await handleUpdatePricingTier(
            pathParameters?.tierId,
            body,
            headers
          );
        }
        break;

      case "DELETE":
        if (path === "/admin/pricing/tiers/{tierId}") {
          return await handleDeactivatePricingTier(
            pathParameters?.tierId,
            headers
          );
        }
        break;
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: "Endpoint not found" }),
    };
  } catch (error) {
    console.error("Error in pricing manager:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

/**
 * Get all active pricing tiers
 */
async function handleGetPricingTiers(
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const tiers = await PricingConfigService.getActivePricingTiers();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        tiers: tiers.sort((a, b) => a.minUsage - b.minUsage),
      }),
    };
  } catch (error) {
    console.error("Error getting pricing tiers:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to retrieve pricing tiers" }),
    };
  }
}

/**
 * Calculate pricing for a given usage amount
 */
async function handleCalculatePricing(
  event: APIGatewayProxyEvent,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const usageCount = parseInt(event.queryStringParameters?.usage || "0");
    const userId = event.queryStringParameters?.userId || "test-user";
    const billingPeriod =
      event.queryStringParameters?.billingPeriod || getCurrentBillingPeriod();

    if (usageCount < 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Usage count must be non-negative" }),
      };
    }

    const calculation = await calculateBillingForUsage(
      userId,
      billingPeriod,
      usageCount
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(calculation),
    };
  } catch (error) {
    console.error("Error calculating pricing:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to calculate pricing" }),
    };
  }
}

/**
 * Create a new pricing tier
 */
async function handleCreatePricingTier(
  body: string | null,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    if (!body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Request body is required" }),
      };
    }

    const tierData = JSON.parse(body);
    const validationResult = validatePricingTierInput(tierData);

    if (!validationResult.isValid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: validationResult.errors }),
      };
    }

    const pricingTier: PricingTier = {
      tierId: tierData.tierId || generateTierId(),
      name: tierData.name,
      minUsage: tierData.minUsage,
      maxUsage: tierData.maxUsage,
      pricePerEvent: tierData.pricePerEvent,
      effectiveDate: tierData.effectiveDate || new Date().toISOString(),
      isActive: tierData.isActive !== false, // Default to true
    };

    await PricingConfigService.setPricingTier(pricingTier);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: "Pricing tier created successfully",
        tier: pricingTier,
      }),
    };
  } catch (error) {
    console.error("Error creating pricing tier:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to create pricing tier" }),
    };
  }
}

/**
 * Update an existing pricing tier
 */
async function handleUpdatePricingTier(
  tierId: string | undefined,
  body: string | null,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    if (!tierId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Tier ID is required" }),
      };
    }

    if (!body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Request body is required" }),
      };
    }

    const tierData = JSON.parse(body);
    const validationResult = validatePricingTierInput(tierData);

    if (!validationResult.isValid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: validationResult.errors }),
      };
    }

    const pricingTier: PricingTier = {
      tierId,
      name: tierData.name,
      minUsage: tierData.minUsage,
      maxUsage: tierData.maxUsage,
      pricePerEvent: tierData.pricePerEvent,
      effectiveDate: tierData.effectiveDate || new Date().toISOString(),
      isActive: tierData.isActive !== false,
    };

    await PricingConfigService.setPricingTier(pricingTier);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "Pricing tier updated successfully",
        tier: pricingTier,
      }),
    };
  } catch (error) {
    console.error("Error updating pricing tier:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to update pricing tier" }),
    };
  }
}

/**
 * Deactivate a pricing tier
 */
async function handleDeactivatePricingTier(
  tierId: string | undefined,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    if (!tierId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Tier ID is required" }),
      };
    }

    // Get existing tier to preserve other properties
    const tiers = await PricingConfigService.getActivePricingTiers();
    const existingTier = tiers.find((t) => t.tierId === tierId);

    if (!existingTier) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Pricing tier not found" }),
      };
    }

    // Deactivate the tier
    const deactivatedTier: PricingTier = {
      ...existingTier,
      isActive: false,
    };

    await PricingConfigService.setPricingTier(deactivatedTier);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "Pricing tier deactivated successfully",
        tier: deactivatedTier,
      }),
    };
  } catch (error) {
    console.error("Error deactivating pricing tier:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to deactivate pricing tier" }),
    };
  }
}

/**
 * Core pricing calculation logic with volume discount support
 */
export async function calculateBillingForUsage(
  userId: string,
  billingPeriod: string,
  usageCount: number
): Promise<BillingCalculation> {
  const tiers = await PricingConfigService.getActivePricingTiers();

  if (tiers.length === 0) {
    throw new Error("No active pricing tiers found");
  }

  // Sort tiers by minUsage to apply volume discounts correctly
  tiers.sort((a, b) => a.minUsage - b.minUsage);

  const breakdown: UsageBreakdown[] = [];
  let totalAmount = 0;
  let currentTierName = "";
  let processedUsage = 0;

  // Apply tiered pricing
  for (const tier of tiers) {
    if (processedUsage >= usageCount) break;

    // Calculate how much usage falls within this tier
    const tierStart = Math.max(tier.minUsage, processedUsage);
    const tierEnd = Math.min(tier.maxUsage, usageCount - 1);

    if (tierStart <= tierEnd) {
      const tierUsage = tierEnd - tierStart + 1;
      const tierAmount = tierUsage * tier.pricePerEvent;

      breakdown.push({
        tier: tier.name,
        eventCount: tierUsage,
        rate: tier.pricePerEvent,
        amount: tierAmount,
      });

      totalAmount += tierAmount;
      processedUsage += tierUsage;
      currentTierName = tier.name;
    }
  }

  // If there's still remaining usage, use the highest tier rate
  if (processedUsage < usageCount && tiers.length > 0) {
    const remainingUsage = usageCount - processedUsage;
    const highestTier = tiers[tiers.length - 1];
    const overflowAmount = remainingUsage * highestTier.pricePerEvent;

    breakdown.push({
      tier: `${highestTier.name} (overflow)`,
      eventCount: remainingUsage,
      rate: highestTier.pricePerEvent,
      amount: overflowAmount,
    });

    totalAmount += overflowAmount;
    currentTierName = highestTier.name;
  }

  // Find the base rate (first tier rate)
  const baseRate = tiers.length > 0 ? tiers[0].pricePerEvent : 0;

  return {
    userId,
    billingPeriod,
    usageCount,
    baseRate,
    discountTier: currentTierName,
    totalAmount: Math.round(totalAmount * 100) / 100, // Round to 2 decimal places
    breakdown,
  };
}

/**
 * Validate pricing tier input data
 */
function validatePricingTierInput(data: any): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (
    !data.name ||
    typeof data.name !== "string" ||
    data.name.trim().length === 0
  ) {
    errors.push("Name is required and must be a non-empty string");
  }

  if (typeof data.minUsage !== "number" || data.minUsage < 0) {
    errors.push("minUsage must be a non-negative number");
  }

  if (typeof data.maxUsage !== "number" || data.maxUsage < 0) {
    errors.push("maxUsage must be a non-negative number");
  }

  if (data.minUsage >= data.maxUsage) {
    errors.push("minUsage must be less than maxUsage");
  }

  if (typeof data.pricePerEvent !== "number" || data.pricePerEvent < 0) {
    errors.push("pricePerEvent must be a non-negative number");
  }

  if (data.effectiveDate && !isValidISODate(data.effectiveDate)) {
    errors.push("effectiveDate must be a valid ISO date string");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a unique tier ID
 */
function generateTierId(): string {
  return `tier-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current billing period in YYYY-MM format
 */
function getCurrentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Validate ISO date string
 */
function isValidISODate(dateString: string): boolean {
  const date = new Date(dateString);
  return (
    date instanceof Date &&
    !isNaN(date.getTime()) &&
    dateString === date.toISOString()
  );
}
