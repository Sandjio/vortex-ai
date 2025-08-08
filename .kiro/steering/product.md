# Product Overview

Vortex AI is a serverless automated code review and analysis platform that integrates with GitHub repositories. The system captures GitHub events (pull requests and commits), analyzes code changes using Amazon Bedrock's Claude AI, generates PDF reports, and delivers them via email.

## Core Features

- **GitHub App Integration**: Receives webhook events from installed GitHub repositories
- **AI-Powered Analysis**: Uses Claude via Amazon Bedrock for intelligent code reviews
- **Event-Driven Architecture**: Built on AWS EventBridge and Lambda for scalable processing
- **PDF Report Generation**: Converts analysis results into formatted PDF reports
- **Email Delivery**: Sends reports to developers via Amazon SES
- **Pay-Per-Use Billing**: Implements usage tracking, billing, and payment processing via Stripe
- **Audit Logging**: Maintains immutable audit trails for all billing and system events

## Current Development Focus

The project is actively implementing a comprehensive pay-per-use pricing system with:

- Usage tracking and billing calculations
- Stripe payment integration
- User account management
- Usage limits and alerts
- Billing APIs and invoice generation
- Audit logging for compliance

## Architecture Philosophy

The system follows serverless-first principles with event-driven design, emphasizing:

- Decoupled components communicating via EventBridge
- Purpose-specific Lambda functions for each processing stage
- Immutable audit trails for billing and compliance
- Scalable, pay-per-use infrastructure
