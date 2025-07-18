# Design Document

## Overview

The pay-per-use pricing system for Vortex AI will track and bill users based on the number of commits and PR events that are successfully analyzed. The system integrates seamlessly with the existing AWS architecture, leveraging EventBridge for event-driven processing, DynamoDB for data storage, and introducing new components for usage tracking, billing, and payment processing.

## Architecture

### High-Level Architecture

The pricing system follows an event-driven architecture that integrates with the existing Vortex AI workflow:

1. **Usage Tracking**: Intercepts successful analysis events to record billable usage
2. **Billing Engine**: Processes usage data to generate invoices and handle payments
3. **User Management**: Manages user accounts, payment methods, and billing preferences
4. **Audit System**: Maintains immutable records of all billable events for transparency

### Integration Points

The system integrates at these key points in the existing workflow:

- **Post-Analysis**: After `analyzeDiff` successfully completes
- **Event Processing**: New EventBridge rules for billing events
- **API Extensions**: New endpoints for billing management
- **Database Extensions**: Additional DynamoDB tables for billing data

## Components and Interfaces

### 1. Usage Tracking Service

**Purpose**: Records billable events when analysis completes successfully

**Components**:

- `usageTracker.ts` - Lambda function triggered by successful analysis events
- EventBridge rule for `bedrock.response` events
- DynamoDB table for usage records

**Interface**:

```typescript
interface UsageEvent {
  userId: string;
  githubUsername: string;
  eventType: "commit" | "pull_request";
  eventId: string;
  repository: string;
  timestamp: string;
  analysisSuccess: boolean;
  billingPeriod: string; // YYYY-MM format
}
```

### 2. Billing Engine

**Purpose**: Processes usage data to calculate charges and generate invoices

**Components**:

- `billingProcessor.ts` - Scheduled Lambda for monthly billing
- `invoiceGenerator.ts` - Creates detailed invoices
- `paymentProcessor.ts` - Handles payment collection
- EventBridge scheduled rules for billing cycles

**Interface**:

```typescript
interface BillingCalculation {
  userId: string;
  billingPeriod: string;
  usageCount: number;
  baseRate: number;
  discountTier: string;
  totalAmount: number;
  breakdown: UsageBreakdown[];
}

interface Invoice {
  invoiceId: string;
  userId: string;
  billingPeriod: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  status: "pending" | "paid" | "failed" | "overdue";
  lineItems: LineItem[];
}
```

### 3. User Account Management

**Purpose**: Manages user billing information and preferences

**Components**:

- `accountManager.ts` - User account operations
- `paymentMethodManager.ts` - Payment method CRUD operations
- API Gateway endpoints for account management

**Interface**:

```typescript
interface UserAccount {
  userId: string;
  githubUsername: string;
  email: string;
  billingPreferences: BillingPreferences;
  paymentMethods: PaymentMethod[];
  usageLimits: UsageLimits;
  status: "active" | "suspended" | "cancelled";
}

interface BillingPreferences {
  frequency: "monthly" | "quarterly";
  currency: string;
  alertThresholds: number[];
}
```

### 4. Pricing Configuration Service

**Purpose**: Manages pricing tiers and rates

**Components**:

- `pricingManager.ts` - Pricing configuration management
- DynamoDB table for pricing rules
- Admin API endpoints for pricing updates

**Interface**:

```typescript
interface PricingTier {
  tierId: string;
  name: string;
  minUsage: number;
  maxUsage: number;
  pricePerEvent: number;
  effectiveDate: string;
}
```

## Data Models

### DynamoDB Tables

#### 1. UsageRecords Table

```
PK: USER#{userId}
SK: {timestamp}#{eventId}
Attributes:
- eventType: string
- repository: string
- billingPeriod: string
- analysisSuccess: boolean
- createdAt: string
- eventMetadata: object
```

#### 2. UserAccounts Table

```
PK: USER#{userId}
SK: PROFILE
Attributes:
- githubUsername: string
- email: string
- billingPreferences: object
- usageLimits: object
- status: string
- createdAt: string
- updatedAt: string
```

#### 3. PaymentMethods Table

```
PK: USER#{userId}
SK: PAYMENT#{paymentMethodId}
Attributes:
- type: string (card, bank_account)
- last4: string
- expiryMonth: number
- expiryYear: number
- isDefault: boolean
- stripePaymentMethodId: string
- createdAt: string
```

#### 4. Invoices Table

```
PK: USER#{userId}
SK: INVOICE#{billingPeriod}
Attributes:
- invoiceId: string
- totalAmount: number
- status: string
- issueDate: string
- dueDate: string
- paidDate: string
- lineItems: object[]
- paymentAttempts: object[]
```

#### 5. PricingConfig Table

```
PK: PRICING
SK: TIER#{tierId}
Attributes:
- name: string
- minUsage: number
- maxUsage: number
- pricePerEvent: number
- effectiveDate: string
- isActive: boolean
```

### External Integrations

#### Stripe Integration

- Payment processing and subscription management
- Webhook handling for payment events
- Secure payment method storage

## Error Handling

### Usage Tracking Errors

- **Failed Analysis Events**: Do not record usage for failed analyses
- **Duplicate Events**: Use idempotency keys to prevent double billing
- **System Errors**: Implement retry logic with exponential backoff

### Billing Errors

- **Payment Failures**: Implement retry schedule (3 attempts over 7 days)
- **Invoice Generation Errors**: Alert administrators and retry
- **Pricing Calculation Errors**: Log errors and use fallback pricing

### User Experience Errors

- **Account Suspension**: Graceful degradation with clear messaging
- **Payment Method Issues**: Clear error messages and resolution steps
- **Usage Limit Exceeded**: Immediate notification and service pause

## Testing Strategy

### Unit Testing

- **Usage Tracking**: Test event processing and deduplication
- **Billing Calculations**: Test pricing tiers and discount application
- **Payment Processing**: Mock Stripe integration for payment flows
- **Account Management**: Test CRUD operations and validation

### Integration Testing

- **End-to-End Billing**: Test complete billing cycle from usage to payment
- **EventBridge Integration**: Test event routing and processing
- **Database Operations**: Test data consistency and transactions
- **External API Integration**: Test Stripe webhook handling

### Load Testing

- **Usage Spike Handling**: Test system under high event volumes
- **Billing Processing**: Test monthly billing for large user bases
- **API Performance**: Test billing API endpoints under load

### Security Testing

- **Payment Data**: Ensure PCI compliance and secure data handling
- **API Authentication**: Test JWT validation and authorization
- **Data Encryption**: Verify encryption at rest and in transit

## Deployment Strategy

### Infrastructure as Code

- Extend existing CDK stacks with new billing components
- Separate billing stack for independent deployment
- Environment-specific configurations (dev, staging, prod)

### Migration Strategy

- **Phase 1**: Deploy usage tracking without billing
- **Phase 2**: Add billing calculation and invoice generation
- **Phase 3**: Enable payment processing and user management
- **Phase 4**: Full feature rollout with monitoring

### Monitoring and Alerting

- **Usage Tracking**: Monitor event processing rates and failures
- **Billing Accuracy**: Alert on calculation anomalies
- **Payment Processing**: Monitor payment success rates
- **System Health**: Comprehensive dashboards and alerts

## Security Considerations

### Data Protection

- **PII Encryption**: Encrypt sensitive user data at rest
- **Payment Data**: Use Stripe for PCI-compliant payment handling
- **Access Control**: Implement least-privilege IAM policies

### Audit Trail

- **Immutable Records**: All billing events stored with cryptographic integrity
- **Change Tracking**: Log all pricing and account modifications
- **Compliance**: Maintain records for regulatory requirements

### API Security

- **Authentication**: JWT-based authentication for all billing APIs
- **Rate Limiting**: Prevent abuse of billing endpoints
- **Input Validation**: Comprehensive validation of all user inputs
