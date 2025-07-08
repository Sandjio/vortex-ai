# Vortex AI: Automated Code Review and Analysis Platform

Vortex AI is a fully serverless platform that provides automated code reviews for GitHub repositories using AWS and AI. It captures pull request and commit events through a GitHub App, analyzes the code using Amazon Bedrock's AI models, generates a PDF report of the analysis, and sends it to the user via email.

## 🌟 Features

- **GitHub App Integration**: Receive push and PR events from installed GitHub repositories.
- **AI-Powered Analysis**: Uses Claude via Amazon Bedrock for intelligent code reviews.
- **Event-Driven Pipeline**: Built entirely on AWS EventBridge and Lambda for modular, scalable processing.
- **PDF Report Generation**: Code reviews are converted into polished PDF reports.
- **Email Delivery**: Sends the review directly to developers via SES.
- **Audit Logging**: All events are persisted in DynamoDB for reference.

## ⚙️ How AWS Lambda is Used

Lambda functions are at the core of the platform's architecture. Each stage of the event processing pipeline is handled by a purpose-specific Lambda function:

1. `WebhookHandler`: Receives GitHub App events via API Gateway and publishes them to EventBridge.
2. `RecordGithubEventDetails`: Logs events into DynamoDB for audit/history.
3. `FetchGithubAPIHandler`: Uses GitHub API to retrieve file diffs for PRs and commits.
4. `CodeReviewPromptHandler`: Sends the diffs to Amazon Bedrock and formats the response.
5. `ConvertCodeReviewToPdfHandler`: Converts the analysis result into a PDF and stores it in S3.
6. `SendReviewByMailHandler`: Fetches the PDF from S3 and sends it via SES.

These Lambda functions are triggered via EventBridge rules to create a decoupled and extensible system.

## 🧰 AWS Services Used

- **AWS Lambda** – for all serverless computation
- **Amazon API Gateway** – receives GitHub App events
- **Amazon EventBridge** – routes events through the pipeline
- **Amazon DynamoDB** – persists metadata for traceability
- **Amazon Bedrock (Claude)** – performs code reviews using AI
- **Amazon S3** – stores PDF reports
- **Amazon SES** – emails reports to developers
- **AWS Secrets Manager** – stores GitHub App secrets
- **IAM** – fine-grained permissions for Lambda and other services

## 🗂️ Repository Structure

```
.
├── infrastructure-cdk/
│   ├── bin/                     # CDK app entry
│   ├── lambda/
│   │   ├── index.ts             # WebhookHandler
│   │   ├── recordGithubEventDetails.ts
│   │   ├── fetchDiffedChanges.ts
│   │   ├── analyzeDiff.ts       # Interacts with Bedrock
│   │   ├── convertToPdf.ts
│   │   └── sendPdfByMail.ts
│   └── lib/                     # CDK constructs & stacks
└── vortex-frontend/            
```

## 🚀 Installation & Deployment

### Prerequisites

- Node.js ≥ 20.x
- AWS CLI + CDK configured
- GitHub App created and installed (see below)
- Bedrock access enabled on AWS

### 1. Clone & Install

```bash
git clone https://github.com/Sandjio/vortex-ai.git
cd vortex-ai/infrastructure-cdk
npm install
```

### 2. Deploy Infrastructure

```bash
npx cdk bootstrap
npx cdk deploy --all
```

Take note of the `API Gateway URL` output.

---

## 🧩 GitHub App Setup & Installation

1. Go to [https://github.com/settings/apps](https://github.com/settings/apps) and create a new **GitHub App**.
2. Set:
   - **Webhook URL** to the API Gateway URL from CDK
   - **Webhook secret**
   - **Permissions**:
     - Repository contents: Read-only
     - Pull requests: Read-only
     - Commit statuses: Read-only
   - **Events**: Check `Push` and `Pull request`
3. Save the App and **install it on your target repositories**.
4. Store the App credentials in Secrets Manager:

> **NB:**  
> To test the GitHub App, you can install it using [this link](https://github.com/apps/vortex-ai-github-app).  
> On the redirected form, enter your email and GitHub username, grant access to the app in a repository, and then make a commit or open a pull request.  
> You will receive the analysis report by email after the event is processed.

```bash
aws secretsmanager create-secret \
  --name vortex/github-app-credentials \
  --secret-string '{
    "app_id": "YOUR_APP_ID",
    "private_key": "-----BEGIN PRIVATE KEY-----\n...",
    "webhook_secret": "your_webhook_secret"
  }'
```

---

## 🧪 Test the Integration

- Push a commit or open a PR in a repository where the app is installed.
- Watch the system process the event, perform analysis, generate a PDF, and send an email.

## 🔍 System Data Flow

```text
GitHub App
   ↓
API Gateway → WebhookHandler → EventBridge
                          ↓            ↓
               recordEventHandler   fetchGithubAPIHandler
                                        ↓
                                   codeReviewPromptHandler → Bedrock
                                        ↓
                               convertCodeReviewToPdfHandler → S3
                                        ↓
                                 sendReviewByMailHandler → SES → Email
```

---

## 📷 Architecture Diagram

![Infrastructure diagram](./docs/vortex-architecture-diagram-v2.png.png)

---

## 🧾 PDF Generation & Delivery

- **PDFs** are created using Lambda + libraries like `pdf-lib` or `puppeteer`.
- Stored in S3 with secure access.
- Retrieved and attached in a SES email for delivery.

---

## 📒 Troubleshooting

| Issue               | Solution                                                |
| ------------------- | ------------------------------------------------------- |
| No webhook received | Check CloudWatch for API Gateway & Lambda logs          |
| Missing GitHub data | Validate permissions and ensure GitHub App is installed |
| PDF not generated   | Inspect `convertToPdf` logs                             |
| Email not received  | Verify SES configuration and region availability        |

---

## 🧑‍💻 Contributions

Pull requests are welcome. Please open an issue to discuss what you’d like to change.
