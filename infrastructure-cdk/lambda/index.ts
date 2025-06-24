import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import * as crypto from "crypto";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const eb = new EventBridgeClient({});
const secretsClient = new SecretsManagerClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;

const getWebhookSecret = async (): Promise<string> => {
  const secretName = "vortex/github-app-webhook-secret";
  try {
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });
    const response = await secretsClient.send(command);

    if (!response.SecretString) throw new Error("SecretString is undefined");

    let secret: string;
    try {
      const parsed = JSON.parse(response.SecretString);
      secret = parsed["vortex-github-app-webhook-secret"];
    } catch {
      // If not JSON, use as is
      secret = response.SecretString;
    }
    return secret;
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
    return crypto.timingSafeEqual(
      Buffer.from(signature.trim(), "utf-8"),
      Buffer.from(digest, "utf-8")
    );
  } catch {
    return false;
  }
};

/**
 * Build event for EventBridge
 */
const buildEvent = (
  detailType: string,
  detail: Record<string, any>
): PutEventsCommand => {
  return new PutEventsCommand({
    Entries: [
      {
        Source: "vortex.github",
        DetailType: detailType,
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify(detail),
      },
    ],
  });
};
/**
 * Lambda entrypoint
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = event.body || "";
  const signature =
    event.headers["x-hub-signature-256"] ||
    event.headers["X-Hub-Signature-256"];

  const eventType = event.headers["x-github-event"];

  if (!body || !signature || !eventType) {
    console.warn("Missing required headers or body");
    return { statusCode: 400, body: "Bad Request" };
  }
  if (!(await verifySignature(body, signature))) {
    console.warn("Invalid webhook signature");
    return { statusCode: 401, body: "Unauthorized" };
  }

  const payload = JSON.parse(body);

  // Handle Pull Request events
  if (eventType === "pull_request") {
    if (["opened", "synchronize"].includes(payload.action)) {
      const pr = payload.pull_request;
      const repo = payload.repository;
      const installation = payload.installation;

      const command = buildEvent(
        payload.action === "opened" ? "pr.created" : "pr.updated",
        {
          prId: pr.id,
          title: pr.title,
          url: pr.html_url,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          repo: repo.full_name,
          action: payload.action,
          installation: installation.id,
        }
      );

      await eb.send(command);
      return { statusCode: 200, body: "PR event sent to EventBridge" };
    } else {
      return { statusCode: 200, body: "Ignored PR action" };
    }
  }

  // Handle Push events (new commits)
  if (eventType === "push") {
    const repo = payload.repository;
    const commits = payload.commits || [];
    const installation = payload.installation;

    const command = buildEvent("commit.pushed", {
      repo: repo.full_name,
      ref: payload.ref,
      head: payload.after,
      pusher: payload.pusher.name,
      installation: installation.id,
      commits: commits.map((c: any) => ({
        id: c.id,
        message: c.message,
        timestamp: c.timestamp,
        url: c.url,
        author: c.author?.name,
      })),
    });

    await eb.send(command);
    return { statusCode: 200, body: "Commit event sent to EventBridge" };
  }

  // Ignore all other event types
  return { statusCode: 200, body: `Ignored event type: ${eventType}` };
};
