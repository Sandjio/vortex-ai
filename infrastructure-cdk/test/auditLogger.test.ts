// Set environment variables before importing modules
process.env.TABLE_NAME = "test-table";

// Mock DynamoDB
const mockSend = jest.fn();

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  PutCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  QueryCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

import { AuditLogger } from "../lib/utils/auditLogger";
import { AuditLogEntry } from "../lib/types/billing";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";

// Mock crypto
jest.mock("crypto");
const mockCreateHash = jest.mocked(createHash);

describe("AuditLogger", () => {
  beforeAll(() => {
    process.env.TABLE_NAME = "test-table";
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup crypto mock
    const mockHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("mock-hash-value"),
    };
    mockCreateHash.mockReturnValue(mockHash as any);
  });

  describe("logEvent", () => {
    it("should log an audit event with cryptographic integrity", async () => {
      const auditEntry: AuditLogEntry = {
        auditId: "test-audit-id",
        userId: "user-123",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        timestamp: "2025-01-01T00:00:00.000Z",
        actorId: "system",
        actorType: "system",
        metadata: { test: "data" },
      };

      mockSend.mockResolvedValueOnce({});

      await AuditLogger.logEvent(auditEntry);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-table",
            Item: expect.any(Object),
            ConditionExpression: "attribute_not_exists(PK)",
          }),
        })
      );

      const putCommand = mockSend.mock.calls[0][0];
      expect(putCommand.input.TableName).toBe("test-table");
      expect(putCommand.input.Item).toMatchObject({
        PK: "AUDIT#invoice#inv-123",
        SK: "2025-01-01T00:00:00.000Z#test-audit-id",
        userId: "user-123",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        actorId: "system",
        actorType: "system",
        metadata: { test: "data" },
        hash: "mock-hash-value",
      });

      // Verify hash creation
      expect(mockCreateHash).toHaveBeenCalledWith("sha256");
    });

    it("should prevent overwriting existing audit entries", async () => {
      const auditEntry: AuditLogEntry = {
        auditId: "test-audit-id",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        timestamp: "2025-01-01T00:00:00.000Z",
        actorId: "system",
        actorType: "system",
      };

      await AuditLogger.logEvent(auditEntry);

      const putCommand = mockSend.mock.calls[0][0];
      expect(putCommand.input.ConditionExpression).toBe(
        "attribute_not_exists(PK)"
      );
    });
  });

  describe("logBillingEvent", () => {
    it("should log a billing event with correct parameters", async () => {
      mockSend.mockResolvedValueOnce({});

      await AuditLogger.logBillingEvent(
        "invoice",
        "inv-123",
        "create",
        "system",
        "system",
        "user-123",
        [{ field: "amount", oldValue: 0, newValue: 100 }],
        { billingPeriod: "2025-01" }
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-table",
            Item: expect.any(Object),
            ConditionExpression: "attribute_not_exists(PK)",
          }),
        })
      );

      const putCommand = mockSend.mock.calls[0][0];
      expect(putCommand.input.Item).toMatchObject({
        PK: "AUDIT#invoice#inv-123",
        userId: "user-123",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        actorId: "system",
        actorType: "system",
        changes: [{ field: "amount", oldValue: 0, newValue: 100 }],
        metadata: { billingPeriod: "2025-01" },
      });
    });
  });

  describe("logAccountModification", () => {
    it("should log account modification with IP and user agent", async () => {
      mockSend.mockResolvedValueOnce({});

      await AuditLogger.logAccountModification(
        "user-123",
        "update",
        "user-123",
        "user",
        [
          {
            field: "email",
            oldValue: "old@test.com",
            newValue: "new@test.com",
          },
        ],
        { source: "web" },
        "192.168.1.1",
        "Mozilla/5.0"
      );

      const putCommand = mockSend.mock.calls[0][0];
      expect(putCommand.input.Item).toMatchObject({
        PK: "AUDIT#user_account#user-123",
        userId: "user-123",
        eventType: "account_modification",
        entityType: "user_account",
        entityId: "user-123",
        action: "update",
        actorId: "user-123",
        actorType: "user",
        changes: [
          {
            field: "email",
            oldValue: "old@test.com",
            newValue: "new@test.com",
          },
        ],
        metadata: { source: "web" },
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      });
    });
  });

  describe("getEntityAuditLogs", () => {
    it("should retrieve audit logs for a specific entity", async () => {
      const mockItems = [
        {
          PK: "AUDIT#invoice#inv-123",
          SK: "2025-01-01T00:00:00.000Z#audit-1",
          userId: "user-123",
          eventType: "billing_event",
          entityType: "invoice",
          entityId: "inv-123",
          action: "create",
          actorId: "system",
          actorType: "system",
        },
      ];

      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await AuditLogger.getEntityAuditLogs(
        "invoice",
        "inv-123",
        10
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-table",
            KeyConditionExpression: "PK = :pk",
          }),
        })
      );

      const queryCommand = mockSend.mock.calls[0][0];
      expect(queryCommand.input.KeyConditionExpression).toBe("PK = :pk");
      expect(queryCommand.input.ExpressionAttributeValues).toEqual({
        ":pk": "AUDIT#invoice#inv-123",
      });
      expect(queryCommand.input.Limit).toBe(10);
      expect(queryCommand.input.ScanIndexForward).toBe(false);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        auditId: "audit-1",
        userId: "user-123",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        timestamp: "2025-01-01T00:00:00.000Z",
        actorId: "system",
        actorType: "system",
      });
    });
  });

  describe("verifyIntegrity", () => {
    it("should verify audit log integrity correctly", () => {
      const entry: AuditLogEntry = {
        auditId: "test-audit-id",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        timestamp: "2025-01-01T00:00:00.000Z",
        actorId: "system",
        actorType: "system",
      };

      const storedHash = "mock-hash-value";

      const isValid = AuditLogger.verifyIntegrity(entry, storedHash);

      expect(isValid).toBe(true);
      expect(mockCreateHash).toHaveBeenCalledWith("sha256");
    });

    it("should detect tampered audit logs", () => {
      const entry: AuditLogEntry = {
        auditId: "test-audit-id",
        eventType: "billing_event",
        entityType: "invoice",
        entityId: "inv-123",
        action: "create",
        timestamp: "2025-01-01T00:00:00.000Z",
        actorId: "system",
        actorType: "system",
      };

      const storedHash = "different-hash-value";

      const isValid = AuditLogger.verifyIntegrity(entry, storedHash);

      expect(isValid).toBe(false);
    });
  });
});
