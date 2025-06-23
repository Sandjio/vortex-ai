import { Construct } from "constructs";
import {
  Stack,
  StackProps,
  aws_lambda_nodejs as lambdaNodejs,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_logs as logs,
  Duration,
} from "aws-cdk-lib";
import * as path from "path";

// import { GithubWebhookHandler } from "../constructs/GithubWebhookHandler"; // The deployment is failing with this import, so we are not using it for now.

interface LambdaStackProps extends StackProps {
  table: dynamodb.ITable;
  eventBus: events.IEventBus;
}

export class LambdaStack extends Stack {
  public readonly webhookHandler: lambdaNodejs.NodejsFunction;
  public readonly recordGithubEventDetailsHandler: lambdaNodejs.NodejsFunction;
  public readonly fetchDiffedChangesHandler: lambdaNodejs.NodejsFunction;
  public readonly lambdaAnalyzeDiff: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Define stageName, e.g., from stack name, context, or environment
    const stageName = this.node.tryGetContext("stage") || "dev";

    this.webhookHandler = new lambdaNodejs.NodejsFunction(
      this,
      "WebhookHandler",
      {
        entry: path.join(__dirname, "..", "..", "lambda", "index.ts"),
        runtime: lambda.Runtime.NODEJS_22_X,
        bundling: {
          externalModules: ["aws-lambda", "@aws-sdk/client-secrets-manager"],
        },
        projectRoot: path.join(__dirname, "../.."),
        environment: {
          EVENT_BUS_NAME: props.eventBus.eventBusName,
        },
        timeout: Duration.seconds(10),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Grant permissions to get the secret value from Secrets Manager
    this.webhookHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:vortex/github-app-webhook-secret-*`,
        ],
      })
    );
    // Grant permissions to the webhook handler to send events to the EventBridge bus
    props.eventBus.grantPutEventsTo(this.webhookHandler);

    this.recordGithubEventDetailsHandler = new lambdaNodejs.NodejsFunction(
      this,
      "RecordGithubEventDetailsHandler",
      {
        entry: path.join(
          __dirname,
          "..",
          "..",
          "lambda",
          "recordGithubEventDetails.ts"
        ),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: { TABLE_NAME: props.table.tableName },
        bundling: {
          externalModules: ["aws-lambda", "@aws-sdk/client-secrets-manager"],
        },
        projectRoot: path.join(__dirname, "../.."),
        timeout: Duration.seconds(10),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );
    // Grant permissions to the recordGithubEventDetailsHandler to write to the DynamoDB table
    props.table.grantWriteData(this.recordGithubEventDetailsHandler);

    this.fetchDiffedChangesHandler = new lambdaNodejs.NodejsFunction(
      this,
      "FetchDiffedChangesHandler",
      {
        entry: path.join(
          __dirname,
          "..",
          "..",
          "lambda",
          "fetchDiffedChanges.ts"
        ),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: { EVENT_BUS_NAME: props.eventBus.eventBusName },
        bundling: {
          externalModules: ["aws-lambda", "@aws-sdk/client-secrets-manager"],
        },
        projectRoot: path.join(__dirname, "../.."),
        timeout: Duration.seconds(10),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );
    // Grant permissions to the fetchDiffedChangesHandler  to send events to the EventBridge bus
    props.eventBus.grantPutEventsTo(this.fetchDiffedChangesHandler);

    this.lambdaAnalyzeDiff = new lambdaNodejs.NodejsFunction(
      this,
      "LambdaAnalyzeDiff",
      {
        entry: path.join(__dirname, "..", "..", "lambda", "analyzeDiff.ts"),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: {
          EVENT_BUS_NAME: props.eventBus.eventBusName,
          MODEL_ID: "anthropic.claude-3-sonnet-20240229", // Store the value in SSM parameter store or Secrets Manager
        },
        bundling: {
          externalModules: ["aws-lambda", "@aws-sdk/client-secrets-manager"],
        },
        projectRoot: path.join(__dirname, "../.."),
        timeout: Duration.seconds(10),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );
    // Grant permissions to the lambdaAnalyzeDiff to send prompts to Bedrock
    // TODO: Check the correctness of the policy statement below
    this.lambdaAnalyzeDiff.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:foundation-model/vortex-analyze-diff`,
        ],
      })
    );

    new events.Rule(this, `PRDataToDynamoRule-${stageName}`, {
      eventBus: props.eventBus,
      enabled: true,
      ruleName: `RecordGithubEventDetailsRule-${stageName}`,
      description: "Records PR and commit details to DynamoDB",
      eventPattern: {
        source: ["vortex.github"],
        detailType: ["pr.created", "pr.updated", "commit.pushed"],
      },
      targets: [
        new targets.LambdaFunction(this.recordGithubEventDetailsHandler),
      ],
    });

    new events.Rule(this, `PRDiffFetcherRule-${stageName}`, {
      eventBus: props.eventBus,
      enabled: true,
      ruleName: `FetchDiffedChangesRule-${stageName}`,
      description: "Fetches diffed changes for PRs or commits",
      eventPattern: {
        source: ["vortex.github"],
        detailType: ["pr.created", "pr.updated", "commit.pushed"],
      },
      targets: [new targets.LambdaFunction(this.fetchDiffedChangesHandler)],
    });

    new events.Rule(this, `DiffAnalysisRule-${stageName}`, {
      eventBus: props.eventBus,
      enabled: true,
      ruleName: `AnalyzeDiffRule-${stageName}`,
      description: "Analyzes diffed changes for PRs",
      eventPattern: {
        source: ["vortex.github"],
        detailType: ["diff.ready"],
      },
      targets: [new targets.LambdaFunction(this.lambdaAnalyzeDiff)],
    });
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
