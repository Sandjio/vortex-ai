import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeEvent } from "aws-lambda";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

type BedrockResponseEvent = EventBridgeEvent<
  "bedrock.response",
  {
    analysisResult: string;
  }
>;

const bedrock = new BedrockRuntimeClient({});
const MODEL_ID =
  process.env.MODEL_ID || "anthropic.claude-3-sonnet-20240229-v1:0";
const eb = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;

const buildPrompt = (files: any[]) => {
  const detailedDiff = files
    .map((f) => {
      return `Filename: ${f.filename}\nChanges:\n${
        f.patch || "(no patch provided)"
      }\n`;
    })
    .join("\n---\n");

  console.log(
    JSON.stringify({
      level: "info",
      message: "Preparing to analyze diff",
      fileCount: files.length,
      filesWithPatch: files.map((f) => ({
        filename: f.filename,
        hasPatch: !!f.patch,
      })),
    })
  );

  const prompt = `
You are a senior software engineer. A code update has been submitted. Please review the following changes below. Your review should include detailed feedback on potential improvements, bugs, security issues, or code smells.

${detailedDiff}

Please provide your insights.
`;

  return prompt;
};

export const handler = async (event: EventBridgeEvent<"diff.ready", any>) => {
  const { type, repo, githubUsername } = event.detail;
  const files = event.detail.files || [];
  console.log(
    JSON.stringify({
      level: "info",
      message: "Received diff event",
      eventId: event.id,
      repo,
      type,
      fileCount: files.length,
      githubUsername,
    })
  );
  console.log("Files to analyze:", files);

  if (!files.length) {
    console.log("No files to analyze.");
    return { statusCode: 200 };
  }

  const prompt = buildPrompt(files);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        temperature: 0.3,
        top_k: 250,
        top_p: 0.95,
        stop_sequences: [],
      }),
    });

    console.log(
      JSON.stringify({
        level: "info",
        message: "Invoking Bedrock model",
        modelId: MODEL_ID,
        eventId: event.id,
        repo: event.detail.repo,
        type: event.detail.type,
        fileCount: files.length,
        githubUsername,
      })
    );
    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    console.log("🧠 Bedrock response:", responseBody);

    // send the response to EventBridge
    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Source: "vortex.github",
          DetailType: "bedrock.response",
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            analysisResult: responseBody,
            eventId: event.id,
            repo,
            type,
            fileCount: files.length,
            githubUsername,
          }),
        },
      ],
    });
    await eb.send(putEventsCommand);

    return { statusCode: 200, body: JSON.stringify(responseBody) };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Bedrock error",
        error: err,
        eventId: event.id,
        repo: event.detail.repo,
        type: event.detail.type,
        fileCount: files.length,
        githubUsername,
      })
    );
    return { statusCode: 500 };
  }
};
