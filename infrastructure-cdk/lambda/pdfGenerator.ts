import { EventBridgeEvent } from "aws-lambda";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
// import { createPdfBuffer } from "../utils/pdfUtils";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

interface PDFContent {
  title: string;
  content: string;
}

const s3 = new S3Client({});
const eb = new EventBridgeClient({});
const ddb = new DynamoDBClient({});

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const DDB_TABLE_NAME = process.env.TABLE_NAME!;
const FONT_PATH = path.join(__dirname, "fonts", "Roboto-Black.ttf");

function createPdfBuffer({ title, content }: PDFContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const stream = new PassThrough();
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.pipe(stream);

    doc.font(FONT_PATH); // ✅ Use the custom font
    doc.fontSize(20).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(content, { align: "left" });

    doc.end();
  });
}

async function fetchEmailFromDynamoDB(
  githubUsername: string
): Promise<string | null> {
  try {
    const result = await ddb.send(
      new GetItemCommand({
        TableName: DDB_TABLE_NAME,
        Key: {
          PK: { S: `GITHUBUSER#${githubUsername}` },
          SK: { S: "PROFILE" },
        },
        ProjectionExpression: "Email",
      })
    );
    return result.Item?.Email?.S || null;
  } catch (err) {
    console.error("Error fetching email from DynamoDB:", err);
    return null;
  }
}

export const handler = async (
  event: EventBridgeEvent<"bedrock.response", any>
) => {
  const { analysisResult, repo, type, fileCount, eventId, githubUsername } =
    event.detail;
  let email: string | null = null;

  if (githubUsername) {
    email = await fetchEmailFromDynamoDB(githubUsername);
  }

  if (!email) {
    console.warn("No email found for githubUsername:", githubUsername);
    // Optionally, you can return or continue with a fallback
    return { statusCode: 404, body: "No email found for user" };
  }

  console.log("Generating PDF from Bedrock analysis...");

  const pdfBuffer = await createPdfBuffer({
    title: `Analysis for ${repo}`,
    content: JSON.stringify(analysisResult, null, 2),
  });

  const objectKey = `reports/${repo}-${Date.now()}-${uuidv4()}.pdf`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    })
  );

  console.log(`✅ PDF uploaded to s3://${BUCKET_NAME}/${objectKey}`);

  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: "vortex.github",
          DetailType: "pdf.generated",
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            s3Key: objectKey,
            repo,
            type,
            fileCount,
            email,
          }),
        },
      ],
    })
  );

  return { statusCode: 200, body: "PDF generated and event sent." };
};
