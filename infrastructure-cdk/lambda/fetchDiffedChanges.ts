// TODO: Cache the installation token for a short period to avoid hitting rate limits with Momento cache
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { EventBridgeEvent } from "aws-lambda";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

type PrEvent = EventBridgeEvent<
  "pr.created" | "pr.updated",
  {
    url: string;
    repo: string;
    prId: number;
    installation: number;
    githubUsername: string;
  }
>;

type CommitPushedEvent = EventBridgeEvent<
  "commit.pushed",
  {
    repo: string;
    commits: Array<{ id: string }>;
    installation: number;
    githubUsername: string;
  }
>;

const eb = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;

const getGithubAppCredentials = async (): Promise<{
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}> => {
  const secretsClient = new SecretsManagerClient({});
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: "vortex/github-app-credentials" })
  );
  if (!secretResponse.SecretString) {
    throw new Error("Missing GitHub App secret.");
  }
  const secretJson = JSON.parse(secretResponse.SecretString);

  if (!secretJson.githubAppId || !secretJson.githubAppPrivateKey) {
    throw new Error(
      "Missing GitHub App credentials: githubAppId or githubAppPrivateKey."
    );
  }
  const GITHUB_APP_ID = secretJson.githubAppId;
  const GITHUB_APP_PRIVATE_KEY = Buffer.from(
    secretJson.githubAppPrivateKey,
    "base64"
  ).toString("utf8");
  return { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY };
};

// Generate GitHub App JWT
function generateAppJWT(
  GITHUB_APP_ID: string,
  GITHUB_APP_PRIVATE_KEY: string
): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 600,
      iss: GITHUB_APP_ID,
    },
    GITHUB_APP_PRIVATE_KEY,
    { algorithm: "RS256" }
  );
}

// Exchange JWT for an installation token
async function getInstallationToken(installationId: number): Promise<string> {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } =
    await getGithubAppCredentials();
  const jwtToken = generateAppJWT(GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to get installation token: ${await res.text()}`);
  }

  const json = (await res.json()) as { token: string };
  return json.token;
}

// Emit diff.ready event
async function emitDiffEvent(detail: Record<string, any>) {
  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: "vortex.github",
          DetailType: "diff.ready",
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify(detail),
        },
      ],
    })
  );
}

export const handler = async (event: PrEvent | CommitPushedEvent) => {
  const detailType = event["detail-type"];
  const installation = event.detail.installation;
  console.log("Installation ID:", installation);
  console.log("Event received:", JSON.stringify(event, null, 2));
  console.log("Detail type:", detailType);
  try {
    const installationToken = await getInstallationToken(installation);

    const headers = {
      Authorization: `Bearer ${installationToken}`,
      "User-Agent": "vortex-ai-github-app",
      Accept: "application/vnd.github.v3+json",
    };

    if (detailType === "pr.created" || detailType === "pr.updated") {
      const { url, repo, prId, githubUsername } = event.detail;

      const apiUrl =
        url
          .replace("https://github.com/", "https://api.github.com/repos/")
          .replace("/pull/", "/pulls/") + "/files";

      const res = await fetch(apiUrl, { headers });
      const data = await res.json();
      const files = Array.isArray(data) ? data : [];
      console.log("Fetched PR files:", data);

      await emitDiffEvent({
        type: "pull_request",
        prId,
        repo,
        files,
        githubUsername,
      });
    } else if (detailType === "commit.pushed") {
      const { repo, commits, githubUsername } = event.detail;

      for (const commit of commits) {
        const apiUrl = `https://api.github.com/repos/${repo}/commits/${commit.id}`;
        const res = await fetch(apiUrl, { headers });
        const data: any = await res.json();
        console.log("Fetched commit data:", data);

        const files = Array.isArray(data.files) ? data.files : [];

        await emitDiffEvent({
          type: "commit",
          commitId: commit.id,
          repo,
          files,
          githubUsername: githubUsername,
        });
      }
    }

    return { statusCode: 200 };
  } catch (err) {
    console.error("GitHub API or EventBridge error:", err);
    return { statusCode: 500, error: (err as Error).message };
  }
};
