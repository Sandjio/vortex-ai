import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeEvent } from "aws-lambda";

const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.MODEL_ID || "anthropic.claude-3-sonnet-20240229"; // or use Amazon.Titan

const buildPrompt = (files: any[]) => {
  const redactedFiles = files.map((f) => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
  }));

  console.log(
    JSON.stringify({
      level: "info",
      message: "Preparing to analyze diff",
      fileCount: files.length,
      redactedFiles,
    })
  );
  const fileDescriptions = files.map((f) => `- ${f.filename}`).join("\n");
  const prompt = `
You are a senior software engineer. A code update has been submitted. Please review the following changes:

${fileDescriptions}

Give detailed feedback on potential improvements, bugs, security issues, or code smells.
`;
  return prompt;
};

export const handler = async (event: EventBridgeEvent<"diff.ready", any>) => {
  const { type, repo } = event.detail;
  const files = event.detail.files || [];

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
        prompt: prompt,
        max_tokens_to_sample: 1024,
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
      })
    );
    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    console.log("🧠 Bedrock response:", responseBody);

    // (Optional) Store response in S3, email, or return
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
      })
    );
    return { statusCode: 500 };
  }
};
