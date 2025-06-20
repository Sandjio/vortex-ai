import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import * as crypto from "crypto";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const ddb = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});
const tableName = process.env.TABLE_NAME!;

const getWebhookSecret = async (): Promise<string> => {
  const secretName = "vortex/github-app-webhook-secret";
  try {
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });
    const response = await secretsClient.send(command);
    const secretValue = response.SecretString;
    if (typeof secretValue !== "string") {
      throw new Error("SecretString is undefined");
    }
    return secretValue;
  } catch (error) {
    console.error("Error retrieving secret:", error);
    throw new Error("Failed to retrieve webhook secret");
  }
};

/**
 * Verifies the GitHub webhook signature using HMAC SHA-256
 */
const verifySignature = async (
  body: string,
  signature: string | undefined
): Promise<boolean> => {
  if (!signature) return false;
  const secret = await getWebhookSecret();
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body, "utf-8");
  const digest = `sha256=${hmac.digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
};

/**
 * Lambda entrypoint
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = event.body || "";
  const signature = event.headers["x-hub-signature-256"];

  if (!(await verifySignature(body, signature))) {
    console.warn("Invalid webhook signature");
    return { statusCode: 401, body: "Unauthorized" };
  }

  const payload = JSON.parse(body);
  const eventType = event.headers["x-github-event"];

  if (eventType !== "pull_request") {
    return { statusCode: 200, body: "Ignored non-PR event" };
  }

  if (payload.action !== "opened" && payload.action !== "synchronize") {
    return { statusCode: 200, body: "Ignored PR action" };
  }

  const pr = payload.pull_request;
  const repo = payload.repository;

  try {
    await ddb.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          id: { S: pr.id.toString() },
          title: { S: pr.title },
          url: { S: pr.html_url },
          created_at: { S: pr.created_at },
          updated_at: { S: pr.updated_at },
          repo: { S: repo.full_name },
          action: { S: payload.action },
        },
      })
    );

    return { statusCode: 200, body: "Pull request data saved." };
  } catch (err) {
    console.error("DynamoDB error:", err);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
