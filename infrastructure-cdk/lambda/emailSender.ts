import { EventBridgeEvent } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { PassThrough } from "stream";
import { Buffer } from "buffer";

const s3 = new S3Client({});
const ses = new SESClient({});

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;

function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export const handler = async (
  event: EventBridgeEvent<"pdf.generated", { s3Key: string; email: string }>
) => {
  const { s3Key, email } = event.detail;

  if (!email) {
    console.warn("❗ No email provided in event");
    return { statusCode: 400, body: "Missing email in event" };
  }

  console.log(`Fetching PDF ${s3Key} from bucket ${BUCKET_NAME}`);

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    })
  );

  if (!obj.Body) {
    throw new Error("S3 object Body is undefined");
  }
  const pdfBuffer = await streamToBuffer(obj.Body as NodeJS.ReadableStream);

  // Construct raw email
  const boundary = `----=_Part_${Date.now()}`;
  const rawEmail = [
    `From: "Code Reviewer" <noreply@emmasandjio.com>`,
    `To: ${email}`,
    `Subject: Your PR Review Report`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    `Hi,`,
    `\nYour PR report is attached as a PDF.`,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="report.pdf"`,
    `Content-Disposition: attachment; filename="report.pdf"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    pdfBuffer.toString("base64"),
    `--${boundary}--`,
  ].join("\r\n");

  await ses.send(
    new SendRawEmailCommand({
      RawMessage: {
        Data: Buffer.from(rawEmail),
      },
    })
  );

  console.log(`✅ Email sent to ${email}`);
  return { statusCode: 200, body: `Email sent to ${email}` };
};
