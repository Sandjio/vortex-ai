import {
  Stack,
  StackProps,
  CfnOutput,
  aws_apigatewayv2 as apiGatewayV2,
  aws_lambda as lambda,
  aws_apigatewayv2_integrations as integrations,
} from "aws-cdk-lib";
import { Construct } from "constructs";

interface ApiStackProps extends StackProps {
  handler: lambda.IFunction;
  registerEmailHandler: lambda.IFunction;
  accountManager: lambda.IFunction;
  paymentMethodManager: lambda.IFunction;
  pricingManager: lambda.IFunction;
  billingApi: lambda.IFunction;
  auditApi: lambda.IFunction;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id);

    const api = new apiGatewayV2.HttpApi(this, "vortexHttpApi", {
      corsPreflight: {
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: [
          apiGatewayV2.CorsHttpMethod.GET,
          apiGatewayV2.CorsHttpMethod.POST,
          apiGatewayV2.CorsHttpMethod.PUT,
          apiGatewayV2.CorsHttpMethod.DELETE,
          apiGatewayV2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [
          "http://localhost:3000",
          "https://main.drbfblsps3a5e.amplifyapp.com",
        ],
      },
    });

    api.addRoutes({
      path: "/webhook",
      methods: [apiGatewayV2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "WebhookIntegration",
        props.handler
      ),
    });

    api.addRoutes({
      path: "/register-email",
      methods: [apiGatewayV2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "RegisterEmailIntegration",
        props.registerEmailHandler
      ),
    });

    // Account management endpoints
    api.addRoutes({
      path: "/accounts",
      methods: [
        apiGatewayV2.HttpMethod.POST,
        apiGatewayV2.HttpMethod.GET,
        apiGatewayV2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AccountManagerIntegration",
        props.accountManager
      ),
    });

    api.addRoutes({
      path: "/accounts/{userId}",
      methods: [
        apiGatewayV2.HttpMethod.GET,
        apiGatewayV2.HttpMethod.PUT,
        apiGatewayV2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AccountManagerByIdIntegration",
        props.accountManager
      ),
    });

    // Payment method management endpoints
    api.addRoutes({
      path: "/accounts/{userId}/payment-methods",
      methods: [
        apiGatewayV2.HttpMethod.GET,
        apiGatewayV2.HttpMethod.POST,
        apiGatewayV2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "PaymentMethodManagerIntegration",
        props.paymentMethodManager
      ),
    });

    api.addRoutes({
      path: "/accounts/{userId}/payment-methods/{paymentMethodId}",
      methods: [
        apiGatewayV2.HttpMethod.PUT,
        apiGatewayV2.HttpMethod.DELETE,
        apiGatewayV2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "PaymentMethodManagerByIdIntegration",
        props.paymentMethodManager
      ),
    });

    // Admin pricing management endpoints
    api.addRoutes({
      path: "/admin/pricing/tiers",
      methods: [
        apiGatewayV2.HttpMethod.GET,
        apiGatewayV2.HttpMethod.POST,
        apiGatewayV2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "PricingManagerIntegration",
        props.pricingManager
      ),
    });

    api.addRoutes({
      path: "/admin/pricing/tiers/{tierId}",
      methods: [
        apiGatewayV2.HttpMethod.PUT,
        apiGatewayV2.HttpMethod.DELETE,
        apiGatewayV2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "PricingManagerByIdIntegration",
        props.pricingManager
      ),
    });

    api.addRoutes({
      path: "/admin/pricing/calculate",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "PricingCalculatorIntegration",
        props.pricingManager
      ),
    });

    // Billing API endpoints
    api.addRoutes({
      path: "/billing/usage-history",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "BillingUsageHistoryIntegration",
        props.billingApi
      ),
    });

    api.addRoutes({
      path: "/billing/current-usage",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "BillingCurrentUsageIntegration",
        props.billingApi
      ),
    });

    api.addRoutes({
      path: "/billing/invoices",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "BillingInvoicesIntegration",
        props.billingApi
      ),
    });

    api.addRoutes({
      path: "/billing/invoices/{billingPeriod}",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "BillingInvoiceByPeriodIntegration",
        props.billingApi
      ),
    });

    // Audit API endpoints
    api.addRoutes({
      path: "/audit/user",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuditUserLogsIntegration",
        props.auditApi
      ),
    });

    api.addRoutes({
      path: "/audit/entity",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuditEntityLogsIntegration",
        props.auditApi
      ),
    });

    api.addRoutes({
      path: "/audit/entity/{entityType}/{entityId}",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuditEntityLogsByPathIntegration",
        props.auditApi
      ),
    });

    api.addRoutes({
      path: "/audit/billing-dispute",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuditBillingDisputeIntegration",
        props.auditApi
      ),
    });

    api.addRoutes({
      path: "/audit/events",
      methods: [apiGatewayV2.HttpMethod.GET, apiGatewayV2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuditEventsByTypeIntegration",
        props.auditApi
      ),
    });

    new CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint + "/webhook",
    });

    new CfnOutput(this, "RegisterEmailApiUrl", {
      value: api.apiEndpoint + "/register-email",
    });

    new CfnOutput(this, "AccountsApiUrl", {
      value: api.apiEndpoint + "/accounts",
    });

    new CfnOutput(this, "PaymentMethodsApiUrl", {
      value: api.apiEndpoint + "/accounts/{userId}/payment-methods",
    });

    new CfnOutput(this, "PricingTiersApiUrl", {
      value: api.apiEndpoint + "/admin/pricing/tiers",
    });

    new CfnOutput(this, "PricingCalculatorApiUrl", {
      value: api.apiEndpoint + "/admin/pricing/calculate",
    });

    new CfnOutput(this, "BillingUsageHistoryApiUrl", {
      value: api.apiEndpoint + "/billing/usage-history",
    });

    new CfnOutput(this, "BillingCurrentUsageApiUrl", {
      value: api.apiEndpoint + "/billing/current-usage",
    });

    new CfnOutput(this, "BillingInvoicesApiUrl", {
      value: api.apiEndpoint + "/billing/invoices",
    });

    new CfnOutput(this, "AuditUserLogsApiUrl", {
      value: api.apiEndpoint + "/audit/user",
    });

    new CfnOutput(this, "AuditEntityLogsApiUrl", {
      value: api.apiEndpoint + "/audit/entity",
    });

    new CfnOutput(this, "AuditBillingDisputeApiUrl", {
      value: api.apiEndpoint + "/audit/billing-dispute",
    });

    new CfnOutput(this, "AuditEventsByTypeApiUrl", {
      value: api.apiEndpoint + "/audit/events",
    });
  }
}
