# Project Structure

## Repository Organization

```
vortex-ai/
├── .kiro/                      # Kiro AI assistant configuration
│   ├── specs/                  # Feature specifications
│   └── steering/               # AI guidance rules
├── docs/                       # Documentation and diagrams
├── infrastructure-cdk/         # AWS CDK infrastructure code
└── vortex-frontend/           # Next.js frontend application
```

## Infrastructure CDK Structure

```
infrastructure-cdk/
├── bin/                        # CDK app entry point
├── lambda/                     # Lambda function implementations
│   ├── index.ts               # GitHub webhook handler
│   ├── accountManager.ts      # User account CRUD operations
│   ├── billingProcessor.ts    # Monthly billing calculations
│   ├── paymentProcessor.ts    # Stripe payment processing
│   ├── usageTracker.ts        # Usage event tracking
│   ├── analyzeDiff.ts         # Bedrock AI analysis
│   ├── pdfGenerator.ts        # PDF report generation
│   └── emailSender.ts         # SES email delivery
├── lib/                       # CDK constructs and stacks
│   ├── constructs/            # Reusable CDK constructs
│   ├── stacks/                # CDK stack definitions
│   │   ├── ApiStack.ts        # API Gateway routes
│   │   ├── DatabaseStack.ts   # DynamoDB tables
│   │   ├── EventBridgeStack.ts # Event routing
│   │   └── LambdaStack.ts     # Lambda functions
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Shared utility functions
└── test/                      # Jest unit tests
```

## Frontend Structure

```
vortex-frontend/
├── src/
│   └── app/                   # Next.js App Router
│       ├── layout.tsx         # Root layout
│       └── page.tsx           # Home page
├── public/                    # Static assets
└── package.json               # Dependencies and scripts
```

## Key Architectural Patterns

### Lambda Function Organization

- **Single Responsibility**: Each Lambda handles one specific business function
- **Event-Driven**: Functions communicate via EventBridge events
- **Shared Utilities**: Common code in `lib/utils/` (database, validation, etc.)
- **Type Safety**: Shared types in `lib/types/` for consistency

### CDK Stack Organization

- **ApiStack**: API Gateway routes and Lambda integrations
- **DatabaseStack**: DynamoDB tables and indexes
- **EventBridgeStack**: Event bus and routing rules
- **LambdaStack**: Function definitions and permissions

### Event Flow Architecture

```
GitHub Webhook → API Gateway → WebhookHandler → EventBridge
                                                     ↓
EventBridge Rules → [recordEventHandler, fetchGithubAPIHandler]
                                                     ↓
                    analyzeDiff → Bedrock → pdfGenerator → emailSender
                         ↓
                    usageTracker → billingProcessor (scheduled)
```

### Naming Conventions

- **Files**: camelCase for TypeScript files
- **Functions**: Descriptive names matching business purpose
- **CDK Resources**: PascalCase with descriptive suffixes
- **API Endpoints**: RESTful paths with kebab-case
- **Environment Variables**: UPPER_SNAKE_CASE

### Testing Structure

- **Unit Tests**: Co-located with source files in `test/` directory
- **Integration Tests**: Separate files with `.integration.test.ts` suffix
- **Test Naming**: `functionName.test.ts` pattern
- **Mock Strategy**: AWS SDK mocking for isolated unit tests
