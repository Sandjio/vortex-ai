import {
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
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
      }
    );
  }
}
