import {
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
  aws_dynamodb as dynamodb,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class DatabaseStack extends Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "PullRequestsTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING }, // TODO: Use a more appropriate partition key
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new CfnOutput(this, "TableName", {
      value: this.table.tableName,
    });
  }
}
