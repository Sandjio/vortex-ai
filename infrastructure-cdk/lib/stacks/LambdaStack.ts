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
  aws_s3 as s3,
  RemovalPolicy,
  Duration,
} from "aws-cdk-lib";
import * as path from "path";

interface LambdaStackProps extends StackProps {
  table: dynamodb.ITable;
  eventBus: events.IEventBus;
}

export class LambdaStack extends Stack {
  public readonly webhookHandler: lambdaNodejs.NodejsFunction;
  public readonly recordGithubEventDetailsHandler: lambdaNodejs.NodejsFunction;
  public readonly fetchDiffedChangesHandler: lambdaNodejs.NodejsFunction;
  public readonly lambdaAnalyzeDiff: lambdaNodejs.NodejsFunction;
  public readonly pdfGenerator: lambda.Function;
  public readonly registerEmailHandler: lambdaNodejs.NodejsFunction;

  public readonly emailSender: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Define stageName, e.g., from stack name, context, or environment
    const stageName = this.node.tryGetContext("stage") || "dev";

    const pdfBucket = new s3.Bucket(this, `PDFBucket-${stageName}`, {
      bucketName: `vortex-pdf-bucket-${stageName}`,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true, // Enable versioning for the bucket
      encryption: s3.BucketEncryption.S3_MANAGED, // Use KMS for production
      publicReadAccess: false, // Ensure the bucket is not publicly accessible
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // Block all public access
    });

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
    // Grant permissions to get the secret value from Secrets Manager
    this.fetchDiffedChangesHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:vortex/github-app-credentials-*`,
        ],
      })
    );

    this.lambdaAnalyzeDiff = new lambdaNodejs.NodejsFunction(
      this,
      "LambdaAnalyzeDiff",
      {
        entry: path.join(__dirname, "..", "..", "lambda", "analyzeDiff.ts"),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: {
          EVENT_BUS_NAME: props.eventBus.eventBusName,
          MODEL_ID: "anthropic.claude-3-sonnet-20240229-v1:0", // Store the value in SSM parameter store or Secrets Manager
        },
        bundling: {
          externalModules: [
            "aws-lambda",
            "@aws-sdk/client-secrets-manager",
            "@aws-sdk/client-bedrock-runtime",
          ],
        },
        projectRoot: path.join(__dirname, "../.."),
        timeout: Duration.minutes(5),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );
    // Grant permissions to the lambdaAnalyzeDiff to send events to the EventBridge bus
    props.eventBus.grantPutEventsTo(this.lambdaAnalyzeDiff);

    // Grant permissions to the lambdaAnalyzeDiff to send prompts to Bedrock
    this.lambdaAnalyzeDiff.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-*`,
        ],
      })
    );

    this.pdfGenerator = new lambdaNodejs.NodejsFunction(this, "PDFGenerator", {
      entry: path.join(__dirname, "..", "..", "lambda", "pdfGenerator.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        S3_BUCKET_NAME: pdfBucket.bucketName,
      },
      bundling: {
        externalModules: ["aws-lambda"],
        commandHooks: {
          beforeBundling(inputDir, outputDir): string[] {
            return [
              `mkdir -p ${outputDir}/fonts`,
              `cp ${inputDir}/lambda/Roboto-Black.ttf ${outputDir}/fonts/Roboto-Black.ttf`,
              `cp -r ${inputDir}/node_modules/pdfkit/js/data ${outputDir}/data || true`,
            ];
          },
          afterBundling(): string[] {
            return [];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
      projectRoot: path.join(__dirname, "../.."),
      timeout: Duration.seconds(60),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    pdfBucket.grantPut(this.pdfGenerator);
    // Grant permissions to the pdfGenerator to send events to the EventBridge bus
    props.eventBus.grantPutEventsTo(this.pdfGenerator);

    this.emailSender = new lambdaNodejs.NodejsFunction(this, "EmailSender", {
      entry: path.join(__dirname, "..", "..", "lambda", "emailSender.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        S3_BUCKET_NAME: pdfBucket.bucketName,
      },
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });
    // Grant permissions to the emailSender to read from the S3 bucket
    pdfBucket.grantRead(this.emailSender);
    // Grant permissions to the emailSender to send emails using SES
    this.emailSender.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"], // or restrict to a specific verified identity
      })
    );

    this.registerEmailHandler = new lambdaNodejs.NodejsFunction(
      this,
      "RegisterEmailHandler",
      {
        entry: path.join(__dirname, "..", "..", "lambda", "registerEmail.ts"),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: { TABLE_NAME: props.table.tableName },
        bundling: {
          externalModules: ["aws-lambda", "@aws-sdk/client-dynamodb"],
        },
        projectRoot: path.join(__dirname, "../.."),
        timeout: Duration.seconds(10),
        memorySize: 256,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }
    );
    props.table.grantWriteData(this.registerEmailHandler);

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

    new events.Rule(this, `BedrockResponseRule-${stageName}`, {
      eventBus: props.eventBus,
      enabled: true,
      ruleName: `BedrockResponseRule-${stageName}`,
      description: "Handles Bedrock response events",
      eventPattern: {
        source: ["vortex.github"],
        detailType: ["bedrock.response"],
      },
      targets: [new targets.LambdaFunction(this.pdfGenerator)],
    });

    new events.Rule(this, `SendEmailRule-${stageName}`, {
      eventBus: props.eventBus,
      enabled: true,
      ruleName: `SendEmailAfterPDFGenerated-${stageName}`,
      description: "Generates PDF from diff analysis",
      eventPattern: {
        source: ["vortex.github"],
        detailType: ["pdf.ready"],
      },
      targets: [new targets.LambdaFunction(this.emailSender)],
    });
  }
}
