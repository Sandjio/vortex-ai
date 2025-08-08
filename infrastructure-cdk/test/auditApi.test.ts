import { handler } from "../lambda/auditApi";
import { AuditLogger } from "../lib/utils/auditLogger";
import { APIGatewayProxyEvent } from "aws-lambda";

// Mock AuditLogger
jest.mock("../lib/utils/auditLogger");
const mockAuditLogger = jest.mocked(AuditLogger);

describe("Audit API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockEvent = (
    path: string,
    method: string = "GET",
    queryParams: Record<string, string> = {},
    headers: Record<string, string> = { Authorization: "Bearer mock-jwt-token" }
  ): APIGatewayProxyEvent => ({
    path,
    httpMethod: method,
    queryStringParameters: queryParams,
    headers,
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "",
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
  });

  describe("CORS handling", () => {
    it("should handle OPTIONS requests for CORS", async () => {
      const event = createMockEvent("/audit/user", "OPTIONS");

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
      });
      expect(result.body).toBe("");
    });
  });

  describe("Authentication", () => {
    it("should return 401 when Authorization header is missing", async () => {
      const event = createMockEvent("/audit/user", "GET", {}, {});

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({
        error: "Authorization header required",
      });
    });

    it("should return 401 when JWT token is invalid", async () => {
      const event = createMockEvent(
        "/audit/user",
        "GET",
        {},
        {
          Authorization: "Bearer invalid-token",
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({
        error: "Invalid authorization token",
      });
    });
  });

  describe("GET /audit/user", () => {
    it("should retrieve user audit logs successfully", async () => {
      const mockAuditLogs = [
        {
          auditId: "audit-1",
          userId: "user-123",
          eventType: "account_modification",
          entityType: "user_account",
          entityId: "user-123",
          action: "update",
          timestamp: "2025-01-01T00:00:00.000Z",
          actorId: "user-123",
          actorType: "user",
        },
      ];

      mockAuditLogger.getUserAuditLogs.mockResolvedValueOnce(
        mockAuditLogs as any
      );

      // Create a valid JWT token (mock)
      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/user",
        "GET",
        {
          limit: "10",
          startTime: "2025-01-01T00:00:00.000Z",
          endTime: "2025-01-31T23:59:59.999Z",
        },
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockAuditLogger.getUserAuditLogs).toHaveBeenCalledWith(
        "user-123",
        10,
        "2025-01-01T00:00:00.000Z",
        "2025-01-31T23:59:59.999Z"
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toEqual({
        auditLogs: mockAuditLogs,
        count: 1,
        filters: {
          userId: "user-123",
          limit: 10,
          startTime: "2025-01-01T00:00:00.000Z",
          endTime: "2025-01-31T23:59:59.999Z",
        },
      });
    });

    it("should use default limit when not provided", async () => {
      mockAuditLogger.getUserAuditLogs.mockResolvedValueOnce([]);

      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/user",
        "GET",
        {},
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockAuditLogger.getUserAuditLogs).toHaveBeenCalledWith(
        "user-123",
        50,
        undefined,
        undefined
      );
    });

    it("should reject limit over 1000", async () => {
      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/user",
        "GET",
        {
          limit: "1001",
        },
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: "Limit cannot exceed 1000",
      });
    });
  });

  describe("GET /audit/entity", () => {
    it("should retrieve entity audit logs successfully", async () => {
      const mockAuditLogs = [
        {
          auditId: "audit-1",
          eventType: "billing_event",
          entityType: "invoice",
          entityId: "inv-123",
          action: "create",
          timestamp: "2025-01-01T00:00:00.000Z",
          actorId: "system",
          actorType: "system",
        },
      ];

      mockAuditLogger.getEntityAuditLogs.mockResolvedValueOnce(
        mockAuditLogs as any
      );

      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/entity",
        "GET",
        {
          entityType: "invoice",
          entityId: "inv-123",
          limit: "25",
        },
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockAuditLogger.getEntityAuditLogs).toHaveBeenCalledWith(
        "invoice",
        "inv-123",
        25,
        undefined,
        undefined
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toEqual({
        auditLogs: mockAuditLogs,
        count: 1,
        filters: {
          entityType: "invoice",
          entityId: "inv-123",
          limit: 25,
          startTime: undefined,
          endTime: undefined,
        },
      });
    });

    it("should return 400 when entityType or entityId is missing", async () => {
      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/entity",
        "GET",
        {
          entityType: "invoice",
          // Missing entityId
        },
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: "entityType and entityId are required parameters",
      });
    });
  });

  describe("GET /audit/entity/{entityType}/{entityId}", () => {
    it("should retrieve specific entity audit logs by path parameters", async () => {
      const mockAuditLogs = [
        {
          auditId: "audit-1",
          eventType: "billing_event",
          entityType: "invoice",
          entityId: "inv-123",
          action: "create",
          timestamp: "2025-01-01T00:00:00.000Z",
          actorId: "system",
          actorType: "system",
        },
      ];

      mockAuditLogger.getEntityAuditLogs.mockResolvedValueOnce(
        mockAuditLogs as any
      );

      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/entity/invoice/inv-123",
        "GET",
        {},
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockAuditLogger.getEntityAuditLogs).toHaveBeenCalledWith(
        "invoice",
        "inv-123",
        50,
        undefined,
        undefined
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody.auditLogs).toEqual(mockAuditLogs);
    });
  });

  describe("GET /audit/billing-dispute", () => {
    it("should retrieve billing dispute trail successfully", async () => {
      const mockAuditLogs = [
        {
          auditId: "audit-1",
          userId: "user-123",
          eventType: "usage_event",
          entityType: "usage_record",
          entityId: "event-123",
          action: "create",
          timestamp: "2025-01-01T00:00:00.000Z",
          actorId: "system",
          actorType: "system",
          metadata: { billingPeriod: "2025-01" },
        },
        {
          auditId: "audit-2",
          userId: "user-123",
          eventType: "billing_event",
          entityType: "invoice",
          entityId: "inv-123",
          action: "create",
          timestamp: "2025-01-02T00:00:00.000Z",
          actorId: "system",
          actorType: "system",
          metadata: { billingPeriod: "2025-01" },
        },
      ];

      mockAuditLogger.getBillingDisputeTrail.mockResolvedValueOnce(
        mockAuditLogs as any
      );

      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/billing-dispute",
        "GET",
        {
          billingPeriod: "2025-01",
        },
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockAuditLogger.getBillingDisputeTrail).toHaveBeenCalledWith(
        "user-123",
        "2025-01",
        undefined,
        undefined
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        auditLogs: mockAuditLogs,
        count: 2,
        billingPeriod: "2025-01",
        userId: "user-123",
        disputeTrail: {
          usageEvents: [mockAuditLogs[0]],
          billingEvents: [mockAuditLogs[1]],
          paymentEvents: [],
        },
      });
    });

    it("should return 400 when billingPeriod is missing", async () => {
      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/billing-dispute",
        "GET",
        {},
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: "billingPeriod is required parameter",
      });
    });
  });

  describe("GET /audit/events", () => {
    it("should retrieve audit logs by event type successfully", async () => {
      const mockAuditLogs = [
        {
          auditId: "audit-1",
          eventType: "billing_event",
          entityType: "invoice",
          entityId: "inv-123",
          action: "create",
          timestamp: "2025-01-01T00:00:00.000Z",
          actorId: "system",
          actorType: "system",
        },
      ];

      mockAuditLogger.getAuditLogsByEventType.mockResolvedValueOnce(
        mockAuditLogs as any
      );

      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/events",
        "GET",
        {
          eventType: "billing_event",
          limit: "100",
        },
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockAuditLogger.getAuditLogsByEventType).toHaveBeenCalledWith(
        "billing_event",
        100,
        undefined,
        undefined
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toEqual({
        auditLogs: mockAuditLogs,
        count: 1,
        filters: {
          eventType: "billing_event",
          limit: 100,
          startTime: undefined,
          endTime: undefined,
        },
      });
    });

    it("should return 400 when eventType is missing", async () => {
      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/events",
        "GET",
        {},
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: "eventType is required parameter",
      });
    });
  });

  describe("Error handling", () => {
    it("should return 404 for unknown endpoints", async () => {
      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/unknown",
        "GET",
        {},
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({
        error: "Endpoint not found",
      });
    });

    it("should return 500 for internal server errors", async () => {
      mockAuditLogger.getUserAuditLogs.mockRejectedValueOnce(
        new Error("Database error")
      );

      const validToken =
        Buffer.from(
          JSON.stringify({
            header: "mock",
          })
        ).toString("base64") +
        "." +
        Buffer.from(
          JSON.stringify({
            sub: "user-123",
          })
        ).toString("base64") +
        ".signature";

      const event = createMockEvent(
        "/audit/user",
        "GET",
        {},
        {
          Authorization: `Bearer ${validToken}`,
        }
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: "Internal server error",
        message: "Database error",
      });
    });
  });
});
