#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LambdaStack } from "../lib/stacks/LambdaStack";
import { DatabaseStack } from "../lib/stacks/DatabaseStack";
import { ApiStack } from "../lib/stacks/ApiStack";
import { GitHubOidcRoleStack } from "../lib/stacks/GitHubOidcRoleStack";
import { EventBridgeStack } from "../lib/stacks/EventBridgeStack";

const app = new cdk.App();

let stageName = app.node.tryGetContext("stageName");
let ssmStageName = app.node.tryGetContext("ssmStageName");

if (!stageName) {
  console.log("Defaulting to dev stage"); // throw new Error("❌ Missing context variable: 'stageName'. Pass with --context stageName=dev");
  stageName = "dev";
}

if (!ssmStageName) {
  console.log(`Defaulting SSM stage name to "stageName":${stageName}`); // throw new Error("❌ Missing context variable: 'ssmStageName'. Pass with --context ssmStageName=dev");
  ssmStageName = stageName;
}

try {
  const eventBridgeStack = new EventBridgeStack(
    app,
    `EventBridgeStack-${stageName}`,
    {
      stageName,
    }
  );

  const dbStack = new DatabaseStack(app, `DatabaseStack-${stageName}`, {
    stageName,
  });

  const lambdaStack = new LambdaStack(app, `LambdaStack-${stageName}`, {
    table: dbStack.table,
    eventBus: eventBridgeStack.eventBus,
  });

  new ApiStack(app, `ApiStack-${stageName}`, {
    handler: lambdaStack.webhookHandler,
  });
  new GitHubOidcRoleStack(app, `GitHubOidcRoleStack-${stageName}`, {});
} catch (error) {
  console.error("Error creating stacks:", error);
  process.exit(1);
}
