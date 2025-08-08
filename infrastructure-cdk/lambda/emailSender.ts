import { EventBridgeEvent } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { PassThrough } from "stream";
import { Buffer } from "buffer";
import { UserAccount } from "../lib/types/billing";

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

/**
 * Send usage alert notification when user approaches their limit
 */
export async function sendUsageAlert(
  userAccount: UserAccount,
  currentUsage: number,
  limit: number,
  usagePercentage: number,
  threshold: number
): Promise<void> {
  const htmlBody = `
<html>
  <body style="font-family: sans-serif; color: #333;">
    <h2 style="color: #FF6B35;">Usage Alert: You're approaching your limit ⚠️</h2>
    <p>Hi ${userAccount.githubUsername},</p>
    <p>
      This is a friendly reminder that you've reached <strong>${Math.round(
        usagePercentage
      )}%</strong> 
      of your monthly usage limit for Vortex AI.
    </p>
    <div style="background-color: #FFF3E0; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #FF6B35;">Usage Summary</h3>
      <ul style="margin: 0;">
        <li><strong>Current Usage:</strong> ${currentUsage} events</li>
        <li><strong>Monthly Limit:</strong> ${limit} events</li>
        <li><strong>Remaining:</strong> ${limit - currentUsage} events</li>
        <li><strong>Usage Percentage:</strong> ${Math.round(
          usagePercentage
        )}%</li>
      </ul>
    </div>
    <p>
      To avoid service interruption, you may want to:
    </p>
    <ul>
      <li>Monitor your remaining usage carefully</li>
      <li>Consider upgrading your usage limit if needed</li>
      <li>Review your repository activity to optimize usage</li>
    </ul>
    <p>
      You can manage your usage limits and billing preferences in your account settings.
    </p>
    <p>Best regards,<br />The Vortex AI Team</p>
  </body>
</html>
`;

  const textBody = `
Hi ${userAccount.githubUsername},

This is a friendly reminder that you've reached ${Math.round(
    usagePercentage
  )}% of your monthly usage limit for Vortex AI.

Usage Summary:
- Current Usage: ${currentUsage} events
- Monthly Limit: ${limit} events
- Remaining: ${limit - currentUsage} events
- Usage Percentage: ${Math.round(usagePercentage)}%

To avoid service interruption, you may want to:
- Monitor your remaining usage carefully
- Consider upgrading your usage limit if needed
- Review your repository activity to optimize usage

You can manage your usage limits and billing preferences in your account settings.

Best regards,
The Vortex AI Team
`;

  const rawEmail = [
    `From: "VortexAI Billing" <billing@emmasandjio.com>`,
    `To: ${userAccount.email}`,
    `Subject: Usage Alert: ${Math.round(
      usagePercentage
    )}% of your limit reached`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="ALERT-${Date.now()}"`,
    ``,
    `--ALERT-${Date.now()}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    textBody,
    ``,
    `--ALERT-${Date.now()}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
    ``,
    `--ALERT-${Date.now()}--`,
  ].join("\r\n");

  await ses.send(
    new SendRawEmailCommand({
      RawMessage: {
        Data: Buffer.from(rawEmail),
      },
    })
  );

  console.log(
    `✅ Usage alert sent to ${userAccount.email} (${Math.round(
      usagePercentage
    )}% threshold)`
  );
}

/**
 * Send suspension notification when user exceeds their limit
 */
export async function sendSuspensionNotification(
  userAccount: UserAccount,
  currentUsage: number,
  limit: number
): Promise<void> {
  const htmlBody = `
<html>
  <body style="font-family: sans-serif; color: #333;">
    <h2 style="color: #DC3545;">Service Suspended: Usage limit exceeded 🚫</h2>
    <p>Hi ${userAccount.githubUsername},</p>
    <p>
      Your Vortex AI service has been temporarily suspended because you've exceeded 
      your monthly usage limit.
    </p>
    <div style="background-color: #F8D7DA; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #DC3545;">
      <h3 style="margin-top: 0; color: #DC3545;">Usage Details</h3>
      <ul style="margin: 0;">
        <li><strong>Current Usage:</strong> ${currentUsage} events</li>
        <li><strong>Monthly Limit:</strong> ${limit} events</li>
        <li><strong>Overage:</strong> ${currentUsage - limit} events</li>
        <li><strong>Status:</strong> Service Suspended</li>
      </ul>
    </div>
    <p>
      <strong>What this means:</strong>
    </p>
    <ul>
      <li>New commits and pull requests will not be analyzed</li>
      <li>You will not receive new code review reports</li>
      <li>Your account will remain suspended until the next billing cycle or limit increase</li>
    </ul>
    <p>
      <strong>To restore service:</strong>
    </p>
    <ul>
      <li>Increase your monthly usage limit in account settings</li>
      <li>Wait for the next billing cycle to begin (limits reset monthly)</li>
      <li>Contact support if you believe this is an error</li>
    </ul>
    <p>
      We apologize for any inconvenience. You can manage your usage limits and 
      billing preferences in your account settings.
    </p>
    <p>Best regards,<br />The Vortex AI Team</p>
  </body>
</html>
`;

  const textBody = `
Hi ${userAccount.githubUsername},

Your Vortex AI service has been temporarily suspended because you've exceeded your monthly usage limit.

Usage Details:
- Current Usage: ${currentUsage} events
- Monthly Limit: ${limit} events
- Overage: ${currentUsage - limit} events
- Status: Service Suspended

What this means:
- New commits and pull requests will not be analyzed
- You will not receive new code review reports
- Your account will remain suspended until the next billing cycle or limit increase

To restore service:
- Increase your monthly usage limit in account settings
- Wait for the next billing cycle to begin (limits reset monthly)
- Contact support if you believe this is an error

We apologize for any inconvenience. You can manage your usage limits and billing preferences in your account settings.

Best regards,
The Vortex AI Team
`;

  const rawEmail = [
    `From: "VortexAI Billing" <billing@emmasandjio.com>`,
    `To: ${userAccount.email}`,
    `Subject: Service Suspended - Usage limit exceeded`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="SUSPEND-${Date.now()}"`,
    ``,
    `--SUSPEND-${Date.now()}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    textBody,
    ``,
    `--SUSPEND-${Date.now()}`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
    ``,
    `--SUSPEND-${Date.now()}--`,
  ].join("\r\n");

  await ses.send(
    new SendRawEmailCommand({
      RawMessage: {
        Data: Buffer.from(rawEmail),
      },
    })
  );

  console.log(`✅ Suspension notification sent to ${userAccount.email}`);
}
