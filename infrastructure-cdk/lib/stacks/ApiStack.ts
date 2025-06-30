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
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id);

    const api = new apiGatewayV2.HttpApi(this, "vortexHttpApi");

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

    new CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint + "/webhook",
    });

    new CfnOutput(this, "RegisterEmailApiUrl", {
      value: api.apiEndpoint + "/register-email",
    });
  }
}
