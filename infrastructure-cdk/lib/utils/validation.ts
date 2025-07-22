import {
  BillingPreferences,
  UsageLimits,
  PaymentMethod,
} from "../types/billing";

/**
 * Email validation using RFC 5322 compliant regex
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * GitHub username validation
 * GitHub usernames can contain alphanumeric characters and hyphens
 * Cannot start or end with hyphen, cannot have consecutive hyphens
 * Must be 1-39 characters long
 */
export const validateGitHubUsername = (username: string): boolean => {
  const githubUsernameRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
  return githubUsernameRegex.test(username);
};

/**
 * Validate billing preferences object
 */
export const validateBillingPreferences = (
  preferences: any
): preferences is BillingPreferences => {
  if (!preferences || typeof preferences !== "object") {
    return false;
  }

  // Validate frequency
  if (!["monthly", "quarterly"].includes(preferences.frequency)) {
    return false;
  }

  // Validate currency (should be 3-letter ISO code)
  if (
    typeof preferences.currency !== "string" ||
    preferences.currency.length !== 3
  ) {
    return false;
  }

  // Validate alert thresholds
  if (!Array.isArray(preferences.alertThresholds)) {
    return false;
  }

  // All thresholds should be positive numbers
  if (
    !preferences.alertThresholds.every(
      (threshold: any) =>
        typeof threshold === "number" && threshold > 0 && threshold <= 1000
    )
  ) {
    return false;
  }

  return true;
};

/**
 * Validate usage limits object
 */
export const validateUsageLimits = (limits: any): limits is UsageLimits => {
  if (!limits || typeof limits !== "object") {
    return false;
  }

  // Monthly limit is optional, but if provided should be a positive number
  if (limits.monthlyLimit !== undefined) {
    if (typeof limits.monthlyLimit !== "number" || limits.monthlyLimit <= 0) {
      return false;
    }
  }

  // Alert and suspend flags should be booleans
  if (typeof limits.alertAt80Percent !== "boolean") {
    return false;
  }

  if (typeof limits.suspendOnExceed !== "boolean") {
    return false;
  }

  return true;
};

/**
 * Validate payment method data for creation
 */
export const validatePaymentMethodData = (data: any): string[] => {
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

  // Additional validation for card type
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

/**
 * Validate user account data for creation
 */
export const validateUserAccountData = (data: any): string[] => {
  const errors: string[] = [];

  if (!data.email || !validateEmail(data.email)) {
    errors.push("Valid email is required");
  }

  if (!data.githubUsername || !validateGitHubUsername(data.githubUsername)) {
    errors.push("Valid GitHub username is required");
  }

  if (
    data.billingPreferences &&
    !validateBillingPreferences(data.billingPreferences)
  ) {
    errors.push("Invalid billing preferences format");
  }

  if (data.usageLimits && !validateUsageLimits(data.usageLimits)) {
    errors.push("Invalid usage limits format");
  }

  if (
    data.status &&
    !["active", "suspended", "cancelled"].includes(data.status)
  ) {
    errors.push("Status must be 'active', 'suspended', or 'cancelled'");
  }

  return errors;
};

/**
 * Validate user account update data
 */
export const validateUserAccountUpdateData = (data: any): string[] => {
  const errors: string[] = [];

  if (data.email !== undefined && !validateEmail(data.email)) {
    errors.push("Invalid email format");
  }

  if (data.githubUsername !== undefined) {
    errors.push("GitHub username cannot be updated");
  }

  if (
    data.billingPreferences !== undefined &&
    !validateBillingPreferences(data.billingPreferences)
  ) {
    errors.push("Invalid billing preferences format");
  }

  if (
    data.usageLimits !== undefined &&
    !validateUsageLimits(data.usageLimits)
  ) {
    errors.push("Invalid usage limits format");
  }

  if (
    data.status !== undefined &&
    !["active", "suspended", "cancelled"].includes(data.status)
  ) {
    errors.push("Status must be 'active', 'suspended', or 'cancelled'");
  }

  return errors;
};

/**
 * Sanitize user account data for API responses
 * Removes sensitive information that shouldn't be exposed
 */
export const sanitizeUserAccount = (userAccount: any): any => {
  const sanitized = { ...userAccount };

  // Remove sensitive payment method information
  if (sanitized.paymentMethods) {
    sanitized.paymentMethods = sanitized.paymentMethods.map((pm: any) => ({
      ...pm,
      stripePaymentMethodId: undefined, // Don't expose Stripe IDs
    }));
  }

  return sanitized;
};

/**
 * Sanitize payment method data for API responses
 */
export const sanitizePaymentMethod = (paymentMethod: PaymentMethod): any => {
  return {
    ...paymentMethod,
    stripePaymentMethodId: undefined, // Don't expose Stripe IDs
  };
};

/**
 * Validate UUID format
 */
export const validateUUID = (uuid: string): boolean => {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Validate billing period format (YYYY-MM)
 */
export const validateBillingPeriod = (period: string): boolean => {
  const periodRegex = /^\d{4}-\d{2}$/;
  if (!periodRegex.test(period)) {
    return false;
  }

  const [year, month] = period.split("-").map(Number);
  return year >= 2020 && year <= 2100 && month >= 1 && month <= 12;
};

/**
 * Validate currency code (ISO 4217)
 */
export const validateCurrencyCode = (currency: string): boolean => {
  const supportedCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];
  return supportedCurrencies.includes(currency.toUpperCase());
};

/**
 * Validate monetary amount (positive number with max 2 decimal places)
 */
export const validateMonetaryAmount = (amount: number): boolean => {
  if (typeof amount !== "number" || amount < 0) {
    return false;
  }

  // Check for max 2 decimal places
  const decimalPlaces = (amount.toString().split(".")[1] || "").length;
  return decimalPlaces <= 2;
};
