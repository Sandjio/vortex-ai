import { Construct } from "constructs";
import {
  Stack,
  StackProps,
  aws_lambda_nodejs as lambdaNodejs,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_logs as logs,
  Duration,
} from "aws-cdk-lib";
import * as path from "path";

// import { GithubWebhookHandler } from "../constructs/GithubWebhookHandler"; // The deployment is failing with this import, so we are not using it for now.

interface LambdaStackProps extends StackProps {
  table: dynamodb.ITable;
}

export class LambdaStack extends Stack {
  public readonly webhookHandler: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    this.webhookHandler = new lambdaNodejs.NodejsFunction(
      this,
      "WebhookHandler",
      {
        entry: path.join(__dirname, "..", "..", "lambda", "index.ts"),
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        bundling: {
          externalModules: ["aws-lambda", "@aws-sdk/client-secrets-manager"],
        },
        projectRoot: path.join(__dirname, "../.."),
        environment: {
          TABLE_NAME: props.table.tableName,
        },
        timeout: Duration.seconds(10),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );

    props.table.grantWriteData(this.webhookHandler);

    this.webhookHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:vortex/github-app-webhook-secret-*`,
        ],
      })
    );
  }
}

// Uncomment the following code if you want to use the GithubWebhookHandler construct instead of inline definition

// import { Construct } from "constructs";
// import {
//   Stack,
//   StackProps,
//   aws_dynamodb as dynamodb,
//   aws_lambda as lambda,
// } from "aws-cdk-lib";
// import { GithubWebhookHandler } from "../constructs/GithubWebhookHandler";

// interface LambdaStackProps extends StackProps {
//   table: dynamodb.ITable;
// }

// export class LambdaStack extends Stack {
//   public readonly webhookHandler: lambda.IFunction;

//   constructor(scope: Construct, id: string, props: LambdaStackProps) {
//     super(scope, id, props);

//     const handler = new GithubWebhookHandler(this, "GithubWebhookHandler", {
//       table: props.table,
//     });

//     this.webhookHandler = handler.function;
//   }
// }
