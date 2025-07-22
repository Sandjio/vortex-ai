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
  }
}
