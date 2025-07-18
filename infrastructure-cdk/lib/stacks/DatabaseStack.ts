import {
  Stack,
  StackProps,
  RemovalPolicy,
  aws_dynamodb as dynamodb,
} from "aws-cdk-lib";
import { Construct } from "constructs";

interface DatabaseStackProps extends StackProps {
  stageName: string;
}
export class DatabaseStack extends Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(
      this,
      `PullRequestsTable-${props.stageName}`,
      {
        partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
        tableName: `PullRequestsTable-${props.stageName}`,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy:
          props.stageName === "prod"
            ? RemovalPolicy.RETAIN
            : RemovalPolicy.DESTROY,
        pointInTimeRecovery: props.stageName === "prod",
      }
    );

    // Add GSI for billing period queries (usage records)
    this.table.addGlobalSecondaryIndex({
      indexName: "BillingPeriodIndex",
      partitionKey: {
        name: "billingPeriod",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for GitHub username lookups (user accounts)
    this.table.addGlobalSecondaryIndex({
      indexName: "GitHubUsernameIndex",
      partitionKey: {
        name: "githubUsername",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for invoice status queries
    this.table.addGlobalSecondaryIndex({
      indexName: "InvoiceStatusIndex",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "dueDate", type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for active pricing tiers
    this.table.addGlobalSecondaryIndex({
      indexName: "ActivePricingIndex",
      partitionKey: { name: "isActive", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "effectiveDate", type: dynamodb.AttributeType.STRING },
    });
  }
}
