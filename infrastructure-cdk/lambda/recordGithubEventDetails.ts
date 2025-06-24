import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeEvent } from "aws-lambda";

const ddb = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME!;

// PR Event Shape
type PullRequestEvent = EventBridgeEvent<
  "pr.created" | "pr.updated",
  {
    prId: number;
    title: string;
    url: string;
    created_at: string;
    updated_at: string;
    repo: string;
    action: string;
  }
>;

// Commit Event Shape
type CommitPushedEvent = EventBridgeEvent<
  "commit.pushed",
  {
    repo: string;
    ref: string;
    head: string;
    pusher: string;
    commits: Array<{
      id: string;
      message: string;
      timestamp: string;
      url: string;
      author: string;
    }>;
  }
>;

export const handler = async (event: PullRequestEvent | CommitPushedEvent) => {
  const detailType = event["detail-type"];

  try {
    if (detailType === "pr.created" || detailType === "pr.updated") {
      const { prId, title, url, created_at, updated_at, repo, action } =
        event.detail;

      await ddb.send(
        new PutItemCommand({
          TableName: tableName,
          Item: {
            PK: { S: `pr#${prId}` },
            SK: { S: created_at },
            id: { S: prId.toString() },
            title: { S: title },
            url: { S: url },
            created_at: { S: created_at },
            updated_at: { S: updated_at },
            repo: { S: repo },
            action: { S: action },
            type: { S: "pull_request" },
          },
        })
      );
      console.log(
        JSON.stringify({
          level: "info",
          message: "PR stored",
          prId,
          repo,
          type: "pull_request",
        })
      );
    } else if (detailType === "commit.pushed") {
      const { repo, ref, head, pusher, commits } = event.detail;

      for (const commit of commits) {
        await ddb.send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              PK: { S: `commit#${commit.id}` },
              SK: { S: commit.timestamp },
              id: { S: commit.id },
              message: { S: commit.message },
              url: { S: commit.url },
              repo: { S: repo },
              ref: { S: ref },
              head: { S: head },
              pusher: { S: pusher },
              author: { S: commit.author },
              timestamp: { S: commit.timestamp },
              type: { S: "commit" },
            },
          })
        );
      }
      console.log(
        JSON.stringify({
          level: "info",
          message: "Commits stored",
          count: commits.length,
          repo,
        })
      );
    } else {
      console.log("Ignored detail type:", detailType);
    }
    return { statusCode: 200 };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "DynamoDB error",
        error: err,
        eventType: detailType,
        repo: event.detail.repo,
      })
    );
    return { statusCode: 500 };
  }
};
