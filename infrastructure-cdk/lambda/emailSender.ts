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
  const base64Pdf = pdfBuffer.toString("base64");

  const htmlBody = `
<html>
  <body style="font-family: sans-serif; color: #333;">
    <h2 style="color: #2E86C1;">Your Code Review Report is Ready 📄</h2>
    <p>Hi there,</p>
    <p>
      We’ve completed the analysis of your recent code changes.
      You’ll find the detailed review attached as a PDF.
    </p>
    <p>Best regards,<br />The Vortex AI Review Team</p>
  </body>
</html>
`;

  const textBody = `
Hi there,

Your code review report is ready. Please find the attached PDF for details.

Best regards,
VortexAI Review Team
`;

  const rawEmail = [
    `From: "VortexAI Code Reviewer" <noreply@emmasandjio.com>`,
    `To: ${email}`,
    `Subject: Your Code Review Report is Ready`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="ALT-${boundary}"`,
    ``,
    `--ALT-${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    textBody,
    ``,
    `--ALT-${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
    ``,
    `--ALT-${boundary}--`,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="code-review-report.pdf"`,
    `Content-Disposition: attachment; filename="code-review-report.pdf"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    base64Pdf,
    ``,
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
