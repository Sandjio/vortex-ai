import { Construct } from "constructs";
import * as path from "path";
import {
  aws_lambda_nodejs as lambdaNodejs,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_iam as iam,
  Duration,
  Stack,
} from "aws-cdk-lib";

interface GithubWebhookHandlerProps {
  table: dynamodb.ITable;
}

export class GithubWebhookHandler extends Construct {
  public readonly function: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: GithubWebhookHandlerProps) {
    super(scope, id);

    this.function = new lambdaNodejs.NodejsFunction(this, "WebhookHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      entry: path.join(__dirname, "..", "..", "lambda", "index.ts"),
      environment: {
        TABLE_NAME: props.table.tableName,
      },
      bundling: {
        externalModules: ["aws-lambda", "@aws-sdk/client-secrets-manager"],
      },
      projectRoot: path.join(__dirname, "../.."),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant write access to the table
    props.table.grantWriteData(this.function);

    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${Stack.of(this).partition}:secretsmanager:${
            Stack.of(this).region
          }:${Stack.of(this).account}:secret:vortex/github-app-webhook-secret`,
        ],
      })
    );
  }
}
