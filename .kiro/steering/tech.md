# Technology Stack

## Backend Infrastructure (CDK)

- **Language**: TypeScript (ES2022, NodeNext modules)
- **Infrastructure**: AWS CDK v2 for Infrastructure as Code
- **Runtime**: Node.js 20.x for Lambda functions
- **Build System**: TypeScript compiler with strict mode enabled

## AWS Services

- **Compute**: AWS Lambda (serverless functions)
- **API**: Amazon API Gateway v2 (HTTP APIs with CORS)
- **Events**: Amazon EventBridge (event-driven architecture)
- **Database**: Amazon DynamoDB (NoSQL for billing, usage, audit data)
- **Storage**: Amazon S3 (PDF report storage)
- **AI/ML**: Amazon Bedrock (Claude for code analysis)
- **Email**: Amazon SES (report delivery)
- **Secrets**: AWS Secrets Manager (GitHub App credentials)
- **Payments**: Stripe SDK integration

## Frontend

- **Framework**: Next.js 15.3.3 with React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Build**: Turbopack for development

## Key Dependencies

### Backend

- `aws-cdk-lib`: Infrastructure definitions
- `@aws-sdk/*`: AWS service clients (DynamoDB, S3, SES, Bedrock, etc.)
- `stripe`: Payment processing
- `jsonwebtoken`: JWT handling for GitHub App authentication
- `pdfkit`: PDF generation
- `marked`: Markdown processing
- `uuid`: Unique identifier generation

### Testing

- `jest`: Unit testing framework
- `ts-jest`: TypeScript support for Jest

## Common Commands

### Infrastructure (CDK)

```bash
cd infrastructure-cdk
npm install
npm run build          # Compile TypeScript
npm run watch          # Watch mode compilation
npm test               # Run Jest tests
npx cdk bootstrap      # Bootstrap CDK (first time)
npx cdk deploy --all   # Deploy all stacks
npx cdk diff           # Show deployment diff
npx cdk synth          # Generate CloudFormation
```

### Frontend

```bash
cd vortex-frontend
npm install
npm run dev            # Development server with Turbopack
npm run build          # Production build
npm run start          # Start production server
npm run lint           # ESLint
```

## Code Style & Standards

- **TypeScript**: Strict mode enabled with comprehensive type checking
- **Module System**: NodeNext with ES2022 target
- **Testing**: Jest with TypeScript support
- **Linting**: ESLint with Next.js configuration
- **API Design**: RESTful endpoints with proper HTTP methods and CORS
- **Error Handling**: Comprehensive try-catch with structured logging
- **Security**: Input validation, signature verification, IAM least privilege
