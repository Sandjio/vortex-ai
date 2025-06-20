#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LambdaStack } from "../lib/stacks/LambdaStack";
import { DatabaseStack } from "../lib/stacks/DatabaseStack";
import { ApiStack } from "../lib/stacks/ApiStack";

const app = new cdk.App();

let stageName = app.node.tryGetContext("stageName");
let ssmStageName = app.node.tryGetContext("ssmStageName");

if (!stageName) {
  console.log("Defaulting to dev stage");
  stageName = "dev";
}

if (!ssmStageName) {
  console.log(`Defaulting SSM stage name to "stageName":${stageName}`);
  ssmStageName = stageName;
}

try {
  const dbStack = new DatabaseStack(app, `DatabaseStack-${stageName}`, {});
  const lambdaStack = new LambdaStack(app, `LambdaStack-${stageName}`, {
    table: dbStack.table,
  });

  new ApiStack(app, `ApiStack-${stageName}`, {
    handler: lambdaStack.webhookHandler,
  });
} catch (error) {
  console.error("Error creating stacks:", error);
  process.exit(1);
}
