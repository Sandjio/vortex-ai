import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({});

const TABLE_NAME = process.env.TABLE_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log("Received event:", JSON.stringify(event));
  try {
    if (!TABLE_NAME) {
      console.error("Environment variable TABLE_NAME is not set.");
      return {
        statusCode: 500,
        body: "Server configuration error: Table name is not set.",
      };
    }
    const body = JSON.parse(event.body || "{}");
    console.log("Parsed body:", body);
    const email = body.email;
    const githubUsername = body.githubUsername;

    if (!email || !githubUsername) {
      return { statusCode: 400, body: "Email and githubUsername are required" };
    }

    const item = {
      PK: { S: `GITHUBUSER#${githubUsername}` },
      SK: { S: "PROFILE" },
      Email: { S: email },
      GitHubUsername: { S: githubUsername },
    };

    console.log("PutItemCommand input:", {
      TableName: TABLE_NAME,
      Item: item,
    });

    await client.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );
    console.log("Successfully inserted item into DynamoDB.");
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": event.headers.origin || "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST",
      },
      body: "Email registered",
    };
  } catch (err) {
    console.error("Error occurred while registering email:", err);
    return { statusCode: 500, body: "Error registering email" };
  }
};
