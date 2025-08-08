// Core billing interfaces and types

export interface UsageEvent {
  userId: string;
  githubUsername: string;
  eventType: "commit" | "pull_request";
  eventId: string;
  repository: string;
  timestamp: string;
  analysisSuccess: boolean;
  billingPeriod: string; // YYYY-MM format
  eventMetadata?: Record<string, any>;
}

export interface BillingPreferences {
  frequency: "monthly" | "quarterly";
  currency: string;
  alertThresholds: number[];
}

export interface UsageLimits {
  monthlyLimit?: number;
  alertAt80Percent: boolean;
  suspendOnExceed: boolean;
}

export interface PaymentMethod {
  paymentMethodId: string;
  type: "card" | "bank_account";
  last4: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  stripePaymentMethodId: string;
  createdAt: string;
}

export interface UserAccount {
  userId: string;
  githubUsername: string;
  email: string;
  billingPreferences: BillingPreferences;
  paymentMethods: PaymentMethod[];
  usageLimits: UsageLimits;
  status: "active" | "suspended" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface PricingTier {
  tierId: string;
  name: string;
  minUsage: number;
  maxUsage: number;
  pricePerEvent: number;
  effectiveDate: string;
  isActive: boolean;
}

export interface UsageBreakdown {
  tier: string;
  eventCount: number;
  rate: number;
  amount: number;
}

export interface BillingCalculation {
  userId: string;
  billingPeriod: string;
  usageCount: number;
  baseRate: number;
  discountTier: string;
  totalAmount: number;
  breakdown: UsageBreakdown[];
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  period: string;
}

export interface PaymentAttempt {
  attemptId: string;
  timestamp: string;
  amount: number;
  status: "pending" | "succeeded" | "failed";
  failureReason?: string;
  stripePaymentIntentId?: string;
}

export interface Invoice {
  invoiceId: string;
  userId: string;
  billingPeriod: string;
  issueDate: string;
  dueDate: string;
  paidDate?: string;
  totalAmount: number;
  status: "pending" | "paid" | "failed" | "overdue";
  lineItems: LineItem[];
  paymentAttempts: PaymentAttempt[];
}

// DynamoDB item interfaces for data persistence
export interface UsageRecordItem {
  PK: string; // USER#{userId}
  SK: string; // {timestamp}#{eventId}
  eventType: string;
  repository: string;
  billingPeriod: string;
  analysisSuccess: boolean;
  createdAt: string;
  eventMetadata?: Record<string, any>;
  githubUsername: string;
}

export interface UserAccountItem {
  PK: string; // USER#{userId}
  SK: string; // PROFILE
  githubUsername: string;
  email: string;
  billingPreferences: BillingPreferences;
  usageLimits: UsageLimits;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethodItem {
  PK: string; // USER#{userId}
  SK: string; // PAYMENT#{paymentMethodId}
  type: string;
  last4: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  stripePaymentMethodId: string;
  createdAt: string;
}

export interface InvoiceItem {
  PK: string; // USER#{userId}
  SK: string; // INVOICE#{billingPeriod}
  invoiceId: string;
  totalAmount: number;
  status: string;
  issueDate: string;
  dueDate: string;
  paidDate?: string;
  lineItems: LineItem[];
  paymentAttempts: PaymentAttempt[];
}

export interface PricingConfigItem {
  PK: string; // PRICING
  SK: string; // TIER#{tierId}
  name: string;
  minUsage: number;
  maxUsage: number;
  pricePerEvent: number;
  effectiveDate: string;
  isActive: boolean;
}

// Audit Log interfaces
export interface AuditLogEntry {
  auditId: string;
  userId?: string;
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  timestamp: string;
  actorId: string;
  actorType: "user" | "system" | "admin";
  changes?: AuditChange[];
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export type AuditEventType =
  | "billing_event"
  | "account_modification"
  | "pricing_change"
  | "payment_event"
  | "usage_event"
  | "system_event";

export type AuditEntityType =
  | "user_account"
  | "payment_method"
  | "invoice"
  | "pricing_tier"
  | "usage_record"
  | "billing_calculation";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "process"
  | "calculate"
  | "charge"
  | "refund"
  | "suspend"
  | "activate";

export interface AuditChange {
  field: string;
  oldValue: any;
  newValue: any;
}

export interface AuditLogItem {
  PK: string; // AUDIT#{entityType}#{entityId} or AUDIT#GLOBAL
  SK: string; // {timestamp}#{auditId}
  userId?: string;
  eventType: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  actorType: string;
  changes?: AuditChange[];
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  hash: string; // Cryptographic hash for integrity verification
}
