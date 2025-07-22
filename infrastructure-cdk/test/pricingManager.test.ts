import { handler, calculateBillingForUsage } from "../lambda/pricingManager";
import { PricingConfigService } from "../lib/utils/billingDatabase";
import { PricingTier } from "../lib/types/billing";
import { APIGatewayProxyEvent } from "aws-lambda";

// Mock the database service
jest.mock("../lib/utils/billingDatabase");
const mockPricingConfigService = PricingConfigService as jest.Mocked<
  typeof PricingConfigService
>;

describe("PricingManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateBillingForUsage", () => {
    const mockTiers: PricingTier[] = [
      {
        tierId: "tier-1",
        name: "Basic",
        minUsage: 0,
        maxUsage: 100,
        pricePerEvent: 0.1,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "tier-2",
        name: "Standard",
        minUsage: 101,
        maxUsage: 500,
        pricePerEvent: 0.08,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "tier-3",
        name: "Premium",
        minUsage: 501,
        maxUsage: 1000,
        pricePerEvent: 0.06,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    beforeEach(() => {
      mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
        mockTiers
      );
    });

    it("should calculate billing for usage within first tier", async () => {
      const result = await calculateBillingForUsage("user-1", "2024-01", 50);

      expect(result.userId).toBe("user-1");
      expect(result.billingPeriod).toBe("2024-01");
      expect(result.usageCount).toBe(50);
      expect(result.baseRate).toBe(0.1);
      expect(result.discountTier).toBe("Basic");
      expect(result.totalAmount).toBe(5.0);
      expect(result.breakdown).toHaveLength(1);
      expect(result.breakdown[0].tier).toBe("Basic");
      expect(result.breakdown[0].eventCount).toBe(50);
      expect(result.breakdown[0].rate).toBe(0.1);
      expect(result.breakdown[0].amount).toBe(5.0);
    });

    it("should calculate billing for usage spanning multiple tiers", async () => {
      const result = await calculateBillingForUsage("user-1", "2024-01", 250);

      expect(result.userId).toBe("user-1");
      expect(result.billingPeriod).toBe("2024-01");
      expect(result.usageCount).toBe(250);
      expect(result.baseRate).toBe(0.1);
      expect(result.discountTier).toBe("Standard");
      expect(result.breakdown).toHaveLength(2);

      // First tier: 0-100 (101 events)
      expect(result.breakdown[0].tier).toBe("Basic");
      expect(result.breakdown[0].eventCount).toBe(101);
      expect(result.breakdown[0].rate).toBe(0.1);

      // Second tier: 101-249 (149 events)
      expect(result.breakdown[1].tier).toBe("Standard");
      expect(result.breakdown[1].eventCount).toBe(149);
      expect(result.breakdown[1].rate).toBe(0.08);

      // Total should be reasonable
      expect(result.totalAmount).toBeCloseTo(22.02, 2);
    });

    it("should calculate billing for usage spanning all tiers", async () => {
      const result = await calculateBillingForUsage("user-1", "2024-01", 750);

      expect(result.userId).toBe("user-1");
      expect(result.billingPeriod).toBe("2024-01");
      expect(result.usageCount).toBe(750);
      expect(result.baseRate).toBe(0.1);
      expect(result.discountTier).toBe("Premium");
      expect(result.breakdown).toHaveLength(3);

      // First tier: 0-100 (101 events)
      expect(result.breakdown[0].tier).toBe("Basic");
      expect(result.breakdown[0].eventCount).toBe(101);

      // Second tier: 101-500 (400 events)
      expect(result.breakdown[1].tier).toBe("Standard");
      expect(result.breakdown[1].eventCount).toBe(400);

      // Third tier: 501-749 (249 events)
      expect(result.breakdown[2].tier).toBe("Premium");
      expect(result.breakdown[2].eventCount).toBe(249);

      // Total should be reasonable
      expect(result.totalAmount).toBeGreaterThan(50);
      expect(result.totalAmount).toBeLessThan(60);
    });

    it("should handle usage exceeding all tiers using highest tier rate", async () => {
      const result = await calculateBillingForUsage("user-1", "2024-01", 1200);

      expect(result.userId).toBe("user-1");
      expect(result.billingPeriod).toBe("2024-01");
      expect(result.usageCount).toBe(1200);
      expect(result.baseRate).toBe(0.1);
      expect(result.discountTier).toBe("Premium");
      expect(result.breakdown).toHaveLength(4);

      // Should have overflow tier
      const overflowTier = result.breakdown.find((b) =>
        b.tier.includes("overflow")
      );
      expect(overflowTier).toBeDefined();
      expect(overflowTier?.eventCount).toBe(199); // 1200 - 1001
      expect(overflowTier?.rate).toBe(0.06);

      // Total should be reasonable
      expect(result.totalAmount).toBeGreaterThan(80);
      expect(result.totalAmount).toBeLessThan(90);
    });

    it("should handle zero usage", async () => {
      const result = await calculateBillingForUsage("user-1", "2024-01", 0);

      expect(result.userId).toBe("user-1");
      expect(result.billingPeriod).toBe("2024-01");
      expect(result.usageCount).toBe(0);
      expect(result.baseRate).toBe(0.1);
      expect(result.discountTier).toBe("");
      expect(result.totalAmount).toBe(0);
      expect(result.breakdown).toHaveLength(0);
    });

    it("should throw error when no active pricing tiers exist", async () => {
      mockPricingConfigService.getActivePricingTiers.mockResolvedValue([]);

      await expect(
        calculateBillingForUsage("user-1", "2024-01", 100)
      ).rejects.toThrow("No active pricing tiers found");
    });

    it("should handle single tier configuration", async () => {
      const singleTier: PricingTier[] = [
        {
          tierId: "tier-1",
          name: "Flat Rate",
          minUsage: 0,
          maxUsage: 999999,
          pricePerEvent: 0.05,
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
      ];

      mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
        singleTier
      );

      const result = await calculateBillingForUsage("user-1", "2024-01", 500);

      expect(result.userId).toBe("user-1");
      expect(result.billingPeriod).toBe("2024-01");
      expect(result.usageCount).toBe(500);
      expect(result.baseRate).toBe(0.05);
      expect(result.discountTier).toBe("Flat Rate");
      expect(result.totalAmount).toBe(25.0);
      expect(result.breakdown).toHaveLength(1);
      expect(result.breakdown[0].tier).toBe("Flat Rate");
      expect(result.breakdown[0].eventCount).toBe(500);
      expect(result.breakdown[0].rate).toBe(0.05);
      expect(result.breakdown[0].amount).toBe(25.0);
    });

    it("should round total amount to 2 decimal places", async () => {
      const precisionTier: PricingTier[] = [
        {
          tierId: "tier-1",
          name: "Precision Test",
          minUsage: 0,
          maxUsage: 100,
          pricePerEvent: 0.033, // This will create rounding scenarios
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
      ];

      mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
        precisionTier
      );

      const result = await calculateBillingForUsage("user-1", "2024-01", 7);

      expect(result.totalAmount).toBe(0.23); // 7 * 0.033 = 0.231, rounded to 0.23
    });
  });

  describe("API Handler", () => {
    const createMockEvent = (
      method: string,
      resource: string,
      body?: string,
      pathParameters?: Record<string, string>,
      queryStringParameters?: Record<string, string>
    ): APIGatewayProxyEvent => ({
      httpMethod: method,
      resource,
      body: body || null,
      pathParameters: pathParameters || null,
      queryStringParameters: queryStringParameters || null,
      headers: {},
      multiValueHeaders: {},
      isBase64Encoded: false,
      path: resource,
      requestContext: {} as any,
      stageVariables: null,
      multiValueQueryStringParameters: null,
    });

    beforeEach(() => {
      mockPricingConfigService.getActivePricingTiers.mockResolvedValue([
        {
          tierId: "tier-1",
          name: "Basic",
          minUsage: 0,
          maxUsage: 100,
          pricePerEvent: 0.1,
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
      ]);
    });

    describe("GET /admin/pricing/tiers", () => {
      it("should return all active pricing tiers", async () => {
        const event = createMockEvent("GET", "/admin/pricing/tiers");
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        expect(response.tiers).toHaveLength(1);
        expect(response.tiers[0].name).toBe("Basic");
      });

      it("should handle database errors gracefully", async () => {
        mockPricingConfigService.getActivePricingTiers.mockRejectedValue(
          new Error("Database error")
        );

        const event = createMockEvent("GET", "/admin/pricing/tiers");
        const result = await handler(event);

        expect(result.statusCode).toBe(500);
        expect(JSON.parse(result.body)).toEqual({
          error: "Failed to retrieve pricing tiers",
        });
      });
    });

    describe("GET /admin/pricing/calculate", () => {
      it("should calculate pricing for given usage", async () => {
        const event = createMockEvent(
          "GET",
          "/admin/pricing/calculate",
          undefined,
          undefined,
          {
            usage: "50",
            userId: "test-user",
            billingPeriod: "2024-01",
          }
        );

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        expect(response.usageCount).toBe(50);
        expect(response.totalAmount).toBe(5.0);
      });

      it("should handle invalid usage parameter", async () => {
        const event = createMockEvent(
          "GET",
          "/admin/pricing/calculate",
          undefined,
          undefined,
          {
            usage: "-10",
          }
        );

        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body)).toEqual({
          error: "Usage count must be non-negative",
        });
      });

      it("should use default values for missing parameters", async () => {
        const event = createMockEvent("GET", "/admin/pricing/calculate");

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        expect(response.usageCount).toBe(0);
        expect(response.userId).toBe("test-user");
      });
    });

    describe("POST /admin/pricing/tiers", () => {
      it("should create a new pricing tier", async () => {
        const tierData = {
          name: "New Tier",
          minUsage: 200,
          maxUsage: 300,
          pricePerEvent: 0.07,
        };

        mockPricingConfigService.setPricingTier.mockResolvedValue();

        const event = createMockEvent(
          "POST",
          "/admin/pricing/tiers",
          JSON.stringify(tierData)
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(201);
        const response = JSON.parse(result.body);
        expect(response.message).toBe("Pricing tier created successfully");
        expect(response.tier.name).toBe("New Tier");
        expect(response.tier.tierId).toBeDefined();
      });

      it("should validate required fields", async () => {
        const invalidTierData = {
          minUsage: 200,
          maxUsage: 300,
          // Missing name and pricePerEvent
        };

        const event = createMockEvent(
          "POST",
          "/admin/pricing/tiers",
          JSON.stringify(invalidTierData)
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        const response = JSON.parse(result.body);
        expect(Array.isArray(response.error)).toBe(true);
        expect(
          response.error.some((err: string) => err.includes("Name is required"))
        ).toBe(true);
        expect(
          response.error.some((err: string) => err.includes("pricePerEvent"))
        ).toBe(true);
      });

      it("should validate minUsage < maxUsage", async () => {
        const invalidTierData = {
          name: "Invalid Tier",
          minUsage: 300,
          maxUsage: 200,
          pricePerEvent: 0.07,
        };

        const event = createMockEvent(
          "POST",
          "/admin/pricing/tiers",
          JSON.stringify(invalidTierData)
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        const response = JSON.parse(result.body);
        expect(Array.isArray(response.error)).toBe(true);
        expect(
          response.error.some((err: string) =>
            err.includes("minUsage must be less than maxUsage")
          )
        ).toBe(true);
      });

      it("should handle missing request body", async () => {
        const event = createMockEvent("POST", "/admin/pricing/tiers");
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body)).toEqual({
          error: "Request body is required",
        });
      });
    });

    describe("PUT /admin/pricing/tiers/{tierId}", () => {
      it("should update an existing pricing tier", async () => {
        const tierData = {
          name: "Updated Tier",
          minUsage: 0,
          maxUsage: 150,
          pricePerEvent: 0.09,
        };

        mockPricingConfigService.setPricingTier.mockResolvedValue();

        const event = createMockEvent(
          "PUT",
          "/admin/pricing/tiers/{tierId}",
          JSON.stringify(tierData),
          { tierId: "tier-1" }
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        expect(response.message).toBe("Pricing tier updated successfully");
        expect(response.tier.tierId).toBe("tier-1");
        expect(response.tier.name).toBe("Updated Tier");
      });

      it("should handle missing tier ID", async () => {
        const event = createMockEvent(
          "PUT",
          "/admin/pricing/tiers/{tierId}",
          JSON.stringify({})
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body)).toEqual({
          error: "Tier ID is required",
        });
      });
    });

    describe("DELETE /admin/pricing/tiers/{tierId}", () => {
      it("should deactivate a pricing tier", async () => {
        mockPricingConfigService.getActivePricingTiers.mockResolvedValue([
          {
            tierId: "tier-1",
            name: "Basic",
            minUsage: 0,
            maxUsage: 100,
            pricePerEvent: 0.1,
            effectiveDate: "2024-01-01T00:00:00.000Z",
            isActive: true,
          },
        ]);
        mockPricingConfigService.setPricingTier.mockResolvedValue();

        const event = createMockEvent(
          "DELETE",
          "/admin/pricing/tiers/{tierId}",
          undefined,
          { tierId: "tier-1" }
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        expect(response.message).toBe("Pricing tier deactivated successfully");
        expect(response.tier.isActive).toBe(false);
      });

      it("should handle non-existent tier ID", async () => {
        mockPricingConfigService.getActivePricingTiers.mockResolvedValue([]);

        const event = createMockEvent(
          "DELETE",
          "/admin/pricing/tiers/{tierId}",
          undefined,
          { tierId: "non-existent" }
        );
        const result = await handler(event);

        expect(result.statusCode).toBe(404);
        expect(JSON.parse(result.body)).toEqual({
          error: "Pricing tier not found",
        });
      });
    });

    describe("OPTIONS requests", () => {
      it("should handle CORS preflight requests", async () => {
        const event = createMockEvent("OPTIONS", "/admin/pricing/tiers");
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(result.headers).toEqual({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        });
      });
    });

    describe("Unsupported endpoints", () => {
      it("should return 404 for unsupported endpoints", async () => {
        const event = createMockEvent("GET", "/unsupported/endpoint");
        const result = await handler(event);

        expect(result.statusCode).toBe(404);
        expect(JSON.parse(result.body)).toEqual({
          error: "Endpoint not found",
        });
      });
    });
  });

  describe("Volume Discount Edge Cases", () => {
    it("should handle overlapping tier ranges correctly", async () => {
      const overlappingTiers: PricingTier[] = [
        {
          tierId: "tier-1",
          name: "Basic",
          minUsage: 0,
          maxUsage: 100,
          pricePerEvent: 0.1,
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
        {
          tierId: "tier-2",
          name: "Standard",
          minUsage: 50, // Overlaps with tier-1
          maxUsage: 200,
          pricePerEvent: 0.08,
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
      ];

      mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
        overlappingTiers
      );

      const result = await calculateBillingForUsage("user-1", "2024-01", 150);

      // Should process tiers in order, applying each tier's range
      expect(result.breakdown.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThan(0);
    });

    it("should handle tiers with gaps correctly", async () => {
      const gappedTiers: PricingTier[] = [
        {
          tierId: "tier-1",
          name: "Basic",
          minUsage: 0,
          maxUsage: 50,
          pricePerEvent: 0.1,
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
        {
          tierId: "tier-2",
          name: "Premium",
          minUsage: 100, // Gap between 51-99
          maxUsage: 200,
          pricePerEvent: 0.06,
          effectiveDate: "2024-01-01T00:00:00.000Z",
          isActive: true,
        },
      ];

      mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
        gappedTiers
      );

      const result = await calculateBillingForUsage("user-1", "2024-01", 150);

      // Should still calculate correctly despite the gap
      expect(result.breakdown.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThan(0);
    });
  });
});
describe("Advanced Volume Discount Scenarios", () => {
  it("should apply volume discounts correctly for enterprise-level usage", async () => {
    const enterpriseTiers: PricingTier[] = [
      {
        tierId: "starter",
        name: "Starter",
        minUsage: 0,
        maxUsage: 1000,
        pricePerEvent: 0.1,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "business",
        name: "Business",
        minUsage: 1001,
        maxUsage: 10000,
        pricePerEvent: 0.05,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "enterprise",
        name: "Enterprise",
        minUsage: 10001,
        maxUsage: 100000,
        pricePerEvent: 0.02,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      enterpriseTiers
    );

    const result = await calculateBillingForUsage(
      "enterprise-user",
      "2024-01",
      25000
    );

    expect(result.breakdown).toHaveLength(3);

    // Starter tier: 0-1000 (1001 events)
    expect(result.breakdown[0].tier).toBe("Starter");
    expect(result.breakdown[0].eventCount).toBe(1001);
    expect(result.breakdown[0].rate).toBe(0.1);
    expect(result.breakdown[0].amount).toBeCloseTo(100.1, 2);

    // Business tier: 1001-10000 (9000 events)
    expect(result.breakdown[1].tier).toBe("Business");
    expect(result.breakdown[1].eventCount).toBe(9000);
    expect(result.breakdown[1].rate).toBe(0.05);
    expect(result.breakdown[1].amount).toBe(450.0);

    // Enterprise tier: 10001-25000 (15000 events)
    expect(result.breakdown[2].tier).toBe("Enterprise");
    expect(result.breakdown[2].eventCount).toBe(15000);
    expect(result.breakdown[2].rate).toBe(0.02);
    expect(result.breakdown[2].amount).toBe(300.0);

    expect(result.totalAmount).toBe(850.1);
    expect(result.discountTier).toBe("Enterprise");
  });

  it("should handle micro-usage with fractional pricing", async () => {
    const microTiers: PricingTier[] = [
      {
        tierId: "micro",
        name: "Micro",
        minUsage: 0,
        maxUsage: 10,
        pricePerEvent: 0.001,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "small",
        name: "Small",
        minUsage: 11,
        maxUsage: 100,
        pricePerEvent: 0.0008,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      microTiers
    );

    const result = await calculateBillingForUsage("micro-user", "2024-01", 15);

    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].amount).toBe(0.01); // 11 * 0.001 = 0.011, rounded to 0.01
    expect(result.breakdown[1].amount).toBe(0.0); // 4 * 0.0008 = 0.0032, rounded to 0.00
    expect(result.totalAmount).toBe(0.01);
  });

  it("should handle exact tier boundary usage", async () => {
    const boundaryTiers: PricingTier[] = [
      {
        tierId: "tier1",
        name: "Tier 1",
        minUsage: 0,
        maxUsage: 100,
        pricePerEvent: 0.1,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "tier2",
        name: "Tier 2",
        minUsage: 101,
        maxUsage: 200,
        pricePerEvent: 0.08,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      boundaryTiers
    );

    // Test exactly at tier boundary
    const result = await calculateBillingForUsage(
      "boundary-user",
      "2024-01",
      101
    );

    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].eventCount).toBe(101);
    expect(result.breakdown[1].eventCount).toBe(1);
    expect(result.totalAmount).toBe(10.18); // 101 * 0.10 + 1 * 0.08
  });

  it("should handle massive usage with overflow pricing", async () => {
    const limitedTiers: PricingTier[] = [
      {
        tierId: "standard",
        name: "Standard",
        minUsage: 0,
        maxUsage: 1000,
        pricePerEvent: 0.05,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "premium",
        name: "Premium",
        minUsage: 1001,
        maxUsage: 5000,
        pricePerEvent: 0.03,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      limitedTiers
    );

    const result = await calculateBillingForUsage(
      "massive-user",
      "2024-01",
      10000
    );

    expect(result.breakdown).toHaveLength(3);

    // Standard tier
    expect(result.breakdown[0].tier).toBe("Standard");
    expect(result.breakdown[0].eventCount).toBe(1001);

    // Premium tier
    expect(result.breakdown[1].tier).toBe("Premium");
    expect(result.breakdown[1].eventCount).toBe(4000);

    // Overflow using premium rate
    expect(result.breakdown[2].tier).toBe("Premium (overflow)");
    expect(result.breakdown[2].eventCount).toBe(4999); // 10000 - 5001
    expect(result.breakdown[2].rate).toBe(0.03);

    expect(result.totalAmount).toBeGreaterThan(300);
  });
});

describe("Billing Calculation Error Handling", () => {
  it("should handle database errors gracefully", async () => {
    mockPricingConfigService.getActivePricingTiers.mockRejectedValue(
      new Error("Database connection failed")
    );

    await expect(
      calculateBillingForUsage("user1", "2024-01", 100)
    ).rejects.toThrow("Database connection failed");
  });

  it("should handle malformed pricing tier data", async () => {
    const malformedTiers: any[] = [
      {
        tierId: "malformed",
        name: "Malformed",
        minUsage: "not-a-number",
        maxUsage: 100,
        pricePerEvent: 0.1,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      malformedTiers
    );

    // Should handle gracefully or throw appropriate error
    const result = await calculateBillingForUsage("user1", "2024-01", 50);

    // The function should either handle this gracefully or we should add validation
    expect(result).toBeDefined();
  });

  it("should handle negative usage gracefully", async () => {
    const normalTiers: PricingTier[] = [
      {
        tierId: "normal",
        name: "Normal",
        minUsage: 0,
        maxUsage: 100,
        pricePerEvent: 0.1,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      normalTiers
    );

    const result = await calculateBillingForUsage("user1", "2024-01", -10);

    // Should handle negative usage (likely treat as 0)
    expect(result.totalAmount).toBe(0);
    expect(result.usageCount).toBe(-10); // Preserves input but calculates as 0
  });
});

describe("Performance and Edge Cases", () => {
  it("should handle very large tier configurations efficiently", async () => {
    // Create 100 tiers to test performance
    const manyTiers: PricingTier[] = Array.from({ length: 100 }, (_, i) => ({
      tierId: `tier-${i}`,
      name: `Tier ${i}`,
      minUsage: i * 1000,
      maxUsage: (i + 1) * 1000 - 1,
      pricePerEvent: 0.1 - i * 0.001, // Decreasing price
      effectiveDate: "2024-01-01T00:00:00.000Z",
      isActive: true,
    }));

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(manyTiers);

    const startTime = Date.now();
    const result = await calculateBillingForUsage(
      "performance-user",
      "2024-01",
      50000
    );
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    expect(result.totalAmount).toBeGreaterThan(0);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("should handle tiers with identical pricing", async () => {
    const identicalPricingTiers: PricingTier[] = [
      {
        tierId: "tier1",
        name: "Tier 1",
        minUsage: 0,
        maxUsage: 100,
        pricePerEvent: 0.05,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "tier2",
        name: "Tier 2",
        minUsage: 101,
        maxUsage: 200,
        pricePerEvent: 0.05, // Same price as tier 1
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      identicalPricingTiers
    );

    const result = await calculateBillingForUsage(
      "identical-user",
      "2024-01",
      150
    );

    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].rate).toBe(0.05);
    expect(result.breakdown[1].rate).toBe(0.05);
    expect(result.totalAmount).toBe(7.55); // 101 * 0.05 + 49 * 0.05
  });

  it("should handle free tier correctly", async () => {
    const freeTierConfig: PricingTier[] = [
      {
        tierId: "free",
        name: "Free Tier",
        minUsage: 0,
        maxUsage: 100,
        pricePerEvent: 0.0,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
      {
        tierId: "paid",
        name: "Paid Tier",
        minUsage: 101,
        maxUsage: 1000,
        pricePerEvent: 0.1,
        effectiveDate: "2024-01-01T00:00:00.000Z",
        isActive: true,
      },
    ];

    mockPricingConfigService.getActivePricingTiers.mockResolvedValue(
      freeTierConfig
    );

    const result = await calculateBillingForUsage("free-user", "2024-01", 150);

    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].amount).toBe(0.0); // Free tier
    expect(result.breakdown[1].amount).toBe(4.9); // 49 * 0.10
    expect(result.totalAmount).toBe(4.9);
  });
});
