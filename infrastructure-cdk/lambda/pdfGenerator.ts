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
import { marked } from "marked"; //

interface PDFContent {
  title: string;
  content: string;
}

const s3 = new S3Client({});
const eb = new EventBridgeClient({});
const ddb = new DynamoDBClient({});

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;
const FONT_PATH = path.join(__dirname, "fonts", "Roboto-Black.ttf");

function createPdfBuffer({ title, content }: PDFContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.pipe(stream);

    doc.font(FONT_PATH); // ✅ Use the custom font
    doc.fontSize(22).text(title, { align: "center", underline: true });
    doc.moveDown();

    // const markdownText =
    //   typeof content === "string" ? content : JSON.stringify(content, null, 2);

    const tokens = marked.lexer(content);
    // const renderInline = (text: string) => {
    //   const inlineTokens = marked.lexer(text, { gfm: true });
    //   const parser = new marked.Parser();

    //   const html = parser.parseInline(inlineTokens);
    //   // Remove <p> wrapper
    //   return html
    //     .replace(/<p>|<\/p>/g, "")
    //     .replace(/&lt;/g, "<")
    //     .replace(/&gt;/g, ">")
    //     .replace(/&amp;/g, "&");
    // };

    // const renderText = (token: any) => {
    //   if (token.tokens) {
    //     for (const inline of token.tokens) {
    //       switch (inline.type) {
    //         case "strong":
    //           doc
    //             .font(FONT_PATH)
    //             .fontSize(12)
    //             .text(inline.text, { continued: true });
    //           break;
    //         case "em":
    //           doc
    //             .font(FONT_PATH)
    //             .fontSize(12)
    //             .text(inline.text, { continued: true, oblique: true });
    //           break;
    //         case "codespan":
    //           doc
    //             .font("Courier")
    //             .fontSize(10)
    //             .fillColor("gray")
    //             .text(inline.text, { continued: true });
    //           break;
    //         default:
    //           doc
    //             .font(FONT_PATH)
    //             .fontSize(12)
    //             .text(inline.raw || inline.text, { continued: true });
    //       }
    //     }
    //     doc.text(" "); // end continuation
    //   } else {
    //     doc.font(FONT_PATH).fontSize(12).text(token.text);
    //   }
    // };

    //     for (const token of tokens) {
    //       switch (token.type) {
    //         case "heading":
    //           doc
    //             .fontSize([20, 16, 14][token.depth - 1] || 12)
    //             .font(FONT_PATH)
    //             .text(token.text, { underline: token.depth === 1 });
    //           doc.moveDown(0.5);
    //           break;

    //         case "paragraph":
    //           renderText(token);
    //           doc.moveDown();
    //           break;

    //         case "list":
    //           token.items.forEach((item: any) => {
    //             doc.font(FONT_PATH).fontSize(12).text(`• ${item.text}`);
    //           });
    //           doc.moveDown();
    //           break;

    //         case "text":
    //           doc.fontSize(12).text(token.text);
    //           doc.moveDown();
    //           break;

    //         case "code":
    //           doc
    //             .font("Courier")
    //             .fontSize(10)
    //             .fillColor("gray")
    //             .text(token.text, { indent: 20 });
    //           doc.moveDown();
    //           break;

    //         case "blockquote":
    //           doc
    //             .font(FONT_PATH)
    //             .fontSize(12)
    //             .fillColor("gray")
    //             .text(`> ${token.text}`, { indent: 10 });
    //           doc.moveDown();
    //           break;

    //         case "space":
    //           doc.moveDown();
    //           break;

    //         default:
    //           break;
    //       }
    //     }
    //     doc.end();
    //   });
    // }
    for (const token of tokens) {
      switch (token.type) {
        case "heading":
          doc
            .fontSize([20, 16, 14][token.depth - 1] || 12)
            .font(FONT_PATH)
            .text(token.text, {
              underline: token.depth === 1,
            });
          doc.moveDown(0.5);
          break;
        case "paragraph":
          doc.font(FONT_PATH).fontSize(12).text(token.text);
          doc.moveDown();
          break;
        case "list":
          token.items.forEach((item: any) => {
            doc.font(FONT_PATH).fontSize(12).text(`• ${item.text}`);
          });
          doc.moveDown();
          break;
        case "blockquote":
          doc
            .font(FONT_PATH)
            .fontSize(12)
            .fillColor("gray")
            .text(`> ${token.text}`, {
              indent: 10,
            });
          doc.moveDown();
          doc.fillColor("black");
          break;
        case "code":
          doc.font("Courier").fontSize(10).fillColor("gray").text(token.text, {
            indent: 20,
          });
          doc.fillColor("black");
          doc.moveDown();
          break;
        default:
          break;
      }
    }

    doc.end();
  });
}
async function fetchEmailFromDynamoDB(
  githubUsername: string
): Promise<string | null> {
  try {
    const result = await ddb.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
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

  // Extract only the `text` from content array
  const markdownText =
    analysisResult?.content?.find((item: any) => item.type === "text")?.text ||
    "No content available";

  const pdfBuffer = await createPdfBuffer({
    title: `Analysis for ${repo}`,
    content: markdownText,
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
          DetailType: "pdf.ready",
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
