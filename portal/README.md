# Prequel Portal

Real-time NextJS web interface for managing coding interviews with 1-second polling, scheduling, and background operations.

## Overview

The portal provides a complete web-based management interface for conducting coding interviews. It features real-time updates via 1-second polling, interview scheduling, background operations with detailed logging, and automatic resource cleanup.

**Target Users:**

- **Web Developers** - Contributing to the NextJS portal codebase
- **API Consumers** - Using the portal's REST APIs from external applications
- **DevOps Engineers** - Building, deploying, and monitoring the portal

## Quick Start

### Development Setup

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Configure AWS** (required for full functionality):

   ```bash
   aws configure sso --profile <AWS_PROFILE>
   aws sso login --profile <AWS_PROFILE>
   ```

3. **Setup Environment**:

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your specific configuration:
   # AWS_PROFILE=your-profile        # Must match your SSO profile
   # PROJECT_PREFIX=your-prefix      # Must match deployed infrastructure
   # ENVIRONMENT=dev                 # Must match deployed infrastructure
   ```

   **⚠️ Critical**: The portal uses a **centralized configuration system** (`src/lib/config.ts`) for all AWS resources. Your local environment must match your deployed infrastructure:
   - **DynamoDB Tables**: `{PROJECT_PREFIX}-{ENVIRONMENT}-interviews`, `{PROJECT_PREFIX}-{ENVIRONMENT}-operations`
   - **S3 Buckets**: `{PROJECT_PREFIX}-{ENVIRONMENT}-challenge`, `{PROJECT_PREFIX}-{ENVIRONMENT}-instance`, `{PROJECT_PREFIX}-{ENVIRONMENT}-history`
   - **ECS Cluster**: `{PROJECT_PREFIX}-{ENVIRONMENT}`

4. **Start Development**:
   ```bash
   npm run dev          # Development server at http://localhost:3000
   npm run test:dev     # Watch mode testing (recommended for TDD)
   ```

### Available Scripts

**Development**:

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint code quality checks
npm run format       # Fix code formatting with Prettier
npm run format:check # Check code formatting without fixing
```

**Testing**:

```bash
# Quick validation (recommended before commits)
npm run test:quick   # Fast tests: format, lint, unit tests, build (2-3 min)

# Full test suite (before creating PRs)
npm run test:all     # Complete suite: all tests + E2E (5-10 min)

# Development workflow
npm run test:dev     # Watch mode - auto-runs tests when files change

# Individual test types
npm run test         # Unit tests only
npm run test:watch   # Unit tests in watch mode
npm run test:coverage # Unit tests with coverage report
npm run test:e2e     # End-to-end tests (headless)
npm run test:e2e:ui  # E2E tests with interactive UI (debugging)
npm run test:e2e:headed # E2E tests with visible browser
```

## Architecture

### Technology Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **Real-time**: 1-second polling via React hooks
- **Testing**: Jest + React Testing Library + Playwright
- **Code Quality**: ESLint + Prettier

### Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── interviews/    # Interview CRUD operations
│   │   ├── operations/    # Background operation management
│   │   ├── takehomes/     # Take-home assessment management
│   │   └── challenges/    # S3-based challenge management
│   ├── interviews/        # Interview management page
│   ├── takehomes/         # Take-home management page
│   ├── challenges/        # Challenge management page
│   ├── __tests__/         # Page component tests
│   └── globals.css        # Global styles
├── components/            # Reusable React components
│   └── __tests__/         # Component tests
├── hooks/                 # Custom React hooks
│   ├── usePolling.ts     # Polling hooks for real-time updates
│   ├── useOperations.ts  # Background operations hook
│   └── __tests__/        # Hook tests
└── lib/                   # Core business logic
    ├── config.ts          # Centralized configuration system
    ├── auth.ts            # Session token management (30-day expiry)
    ├── operations.ts      # Operation management (DynamoDB)
    ├── scheduler.ts       # Background scheduler service
    ├── terraform.ts       # AWS infrastructure management
    ├── interviews.ts      # DynamoDB interview management
    ├── assessments.ts     # Take-home assessment management
    ├── fileExtraction.ts  # File saving and extraction
    └── __mocks__/         # Test mocks

e2e/                       # End-to-end tests
scripts/                   # Helper scripts for testing
coverage/                  # Test coverage reports (generated)
playwright-report/         # E2E test reports (generated)
```

### Features

**Real-time Interview Management**
Instant scheduling allows interviews to be created for future execution with datetime picker integration. Live status updates via 1-second polling provide real-time status changes without page refresh. Background operations handle non-blocking interview creation and destruction with detailed logging, while mandatory auto-destroy with configurable timeouts (30min-4hrs) prevents resource waste. The operation dashboard provides real-time operation logs and cancellation capabilities.

**AWS Integration & Infrastructure**
Automated infrastructure management through Terraform handles ECS, ALB, and Route53 provisioning seamlessly. S3 challenge storage enables dynamic challenge loading from S3 buckets, while SOCI indexing via Lambda provides container image optimization for faster startup times. IAM role authentication ensures secure AWS access without manual credential management.

**Enhanced Challenge Management**
Comprehensive challenge system with drag-and-drop file/folder uploads supports complex project structures including `.vscode` configurations. Mixed upload capability allows simultaneous file and folder selection, while automatic dependency installation detects package.json, pyproject.toml, and requirements.txt for environment setup. Project structure guidelines help users upload correctly formatted challenges.

**Enhanced File Management & History**
Smart download system shows download buttons based on `saveFiles` interview attribute rather than S3 file existence checks. Improved error handling provides user-friendly messages for download failures, with specific guidance for missing files. File extraction service uses centralized configuration for consistent S3 bucket naming across all environments.

**Developer Experience**
Full TypeScript integration provides type safety with strict configuration, while Tailwind CSS enables utility-first styling with responsive design. The real-time UI includes live connection indicators and instant status updates. Comprehensive testing coverage spans unit, integration, and E2E tests for reliable development workflows.

## API Reference

### Interviews API

#### Create Interview

```http
POST /api/interviews/create
Content-Type: application/json

{
  "candidateName": "John Doe",
  "challenge": "javascript",
  "scheduledAt": "2024-01-15T10:00:00Z",  // Optional: schedule for future
  "autoDestroyMinutes": 60                // Required: 30-240 minutes
}
```

**Response**:

```json
{
  "operationId": "op-12345",
  "interviewId": "int-67890",
  "candidateName": "John Doe",
  "challenge": "javascript",
  "password": "abc123def456",
  "scheduledAt": "2024-01-15T10:00:00Z",
  "autoDestroyAt": "2024-01-15T11:00:00Z",
  "message": "Interview creation started in background"
}
```

#### List Interviews

```http
GET /api/interviews
```

**Response**:

```json
{
  "interviews": [
    {
      "id": "int-67890",
      "candidateName": "John Doe",
      "challenge": "javascript",
      "status": "active",
      "accessUrl": "https://int-67890.interviews.example.com",
      "password": "abc123def456",
      "createdAt": "2024-01-15T09:00:00Z",
      "scheduledAt": "2024-01-15T10:00:00Z",
      "autoDestroyAt": "2024-01-15T11:00:00Z"
    }
  ]
}
```

**Status Values**:

- `scheduled` - Waiting for scheduled start time
- `initializing` - Provisioning AWS infrastructure
- `configuring` - Setting up VS Code environment
- `active` - Ready for candidate access
- `destroying` - Cleaning up resources
- `destroyed` - Fully removed
- `error` - Failed state requiring manual intervention

#### Destroy Interview

```http
POST /api/interviews/{id}/destroy
```

**Response**:

```json
{
  "operationId": "op-54321",
  "interviewId": "int-67890",
  "message": "Interview destruction started in background"
}
```

#### Download Interview Files

```http
GET /api/interviews/{id}/files
```

Downloads candidate files saved from a completed interview (only available if `saveFiles` was enabled during destruction).

**Response**:

- **Success**: `tar.gz` file download with filename `interview_{id}_{candidateName}.tar.gz`
- **Content-Type**: `application/gzip`
- **Status Codes**:
  - `200` - File download successful
  - `404` - Interview not found or no saved files available
  - `500` - S3 access error

**Requirements**:

- Interview must exist in DynamoDB
- Interview must have `historyS3Key` field (files were saved)
- Files must exist in S3 history bucket

### Operations API

#### List Operations

```http
GET /api/operations?interviewId={id}  // Optional filter
```

**Response**:

```json
{
  "operations": [
    {
      "id": "op-12345",
      "type": "create",
      "status": "completed",
      "interviewId": "int-67890",
      "candidateName": "John Doe",
      "challenge": "javascript",
      "startedAt": "2024-01-15T09:00:00Z",
      "completedAt": "2024-01-15T09:05:00Z",
      "scheduledAt": "2024-01-15T10:00:00Z",
      "autoDestroyAt": "2024-01-15T11:00:00Z",
      "logs": [
        "[2024-01-15T09:00:00Z] Starting interview creation for John Doe",
        "[2024-01-15T09:02:00Z] Terraform applying infrastructure...",
        "[2024-01-15T09:05:00Z] ✅ Interview created successfully!"
      ],
      "result": {
        "success": true,
        "accessUrl": "https://int-67890.interviews.example.com",
        "password": "abc123def456"
      }
    }
  ]
}
```

#### Cancel Operation

```http
POST /api/operations/{id}/cancel
```

#### Get Operation Logs

```http
GET /api/operations/{id}/logs
```

### Real-time Updates

The portal uses 1-second polling for real-time updates instead of SSE. See `docs/data-fetching.md` for architecture details.

**Polling Hooks**:

```typescript
// Poll interviews - server merges operation status
const { interviews, hasInProgressInterviews } = useInterviewPolling()

// Poll take-homes
const { takeHomes, hasInProgressTakeHomes } = useTakeHomePolling()

// Poll operations for toast notifications
const { lastOperation } = useOperationPolling({ filterPrefix: 'INTERVIEW#' })
```

### Challenges API

#### List Available Challenges

```http
GET /api/challenges
```

**Response**:

```json
{
  "success": true,
  "challenges": [
    {
      "id": "javascript",
      "name": "Javascript",
      "configuration": {
        "cpu": 1024,
        "memory": 2048,
        "storage": 20
      }
    },
    {
      "id": "python",
      "name": "Python",
      "configuration": {
        "cpu": 2048,
        "memory": 4096,
        "storage": 20
      }
    }
  ]
}
```

#### Create New Challenge

```http
POST /api/challenges/manage/create
Content-Type: application/json

{
  "challengeName": "New Challenge",
  "configuration": {
    "cpu": 1024,
    "memory": 2048,
    "storage": 20
  }
}
```

#### Upload Challenge Files

```http
POST /api/challenges/manage/upload
Content-Type: multipart/form-data

FormData:
- challengeId: string (challenge ID)
- files: File[] (multiple files and folders)
- filePaths: string[] (preserve folder structure)
```

**Features**:

- **Folder Support** - Upload entire directory structures including `.vscode` configuration folders
- **Mixed Upload** - Upload files and folders simultaneously via drag-and-drop
- **Path Preservation** - Maintains folder hierarchy using `webkitRelativePath`
- **User Guidelines** - Provides project structure examples and dependency installation info

**Upload Guidelines Shown to Users**:

```
📁 Project Structure Guidelines:

Upload files/folders to the PROJECT ROOT (not the project folder itself):

✅ Correct Structure:
project-root/
├── src/
│   ├── main.js
│   └── utils.js
├── .vscode/
│   └── settings.json
├── package.json         # Auto-installs dependencies
├── pyproject.toml       # Auto-creates .venv
└── README.md

❌ Incorrect (don't upload the project folder):
my-project/
└── project-root/
    ├── src/
    └── package.json

🔧 Automatic Dependency Installation:
When uploading package.json, pyproject.toml, uv.lock, or requirements.txt
to the project root, dependencies will be installed automatically before
candidate access.
```

#### Delete Challenge

```http
DELETE /api/challenges/manage/delete
Content-Type: application/json

{
  "challengeId": "challenge-to-delete"
}
```

### Error Handling

All endpoints return standard error format:

```json
{
  "error": "Error message describing what went wrong",
  "details": "Additional technical details (development only)"
}
```

## Testing

### Test Strategy

**Local-First Approach** - All testing designed to run locally for fast feedback:

- **Unit Tests** - Jest + React Testing Library
- **E2E Tests** - Playwright with browser automation
- **Integration Tests** - API route testing with mocks
- **Code Quality** - ESLint + Prettier

### Recommended Workflow

**During Development**:

```bash
# Terminal 1: Development server
npm run dev

# Terminal 2: Continuous testing
npm run test:dev
```

**Before Each Commit**:

```bash
npm run test:quick   # 2-3 minutes validation
```

**Before Creating PR**:

```bash
npm run test:all     # 5-10 minutes full confidence check
```

### Testing Real-time Features

**Polling Testing**:

The portal uses 1-second polling which works in all environments. Check browser Network tab to see polling requests to `/api/interviews` or `/api/takehomes`.

**Manual Testing Checklist**:

- [ ] Status indicator shows "Active" when interviews are in progress
- [ ] Creating interview appears in list within 1 second
- [ ] Scheduling interview shows correct scheduled time
- [ ] Status changes (initializing → configuring → active) update within 1 second
- [ ] Auto-destroy countdown displays correctly
- [ ] Toast notifications appear when operations complete

### Debugging Tests

**Unit Tests**:

- Use `test.only()` to focus on specific tests
- Add `console.log()` for debugging
- Check `coverage/` directory for coverage reports

**E2E Tests**:

- Use `npm run test:e2e:ui` for interactive debugging
- Use `await page.pause()` to pause execution
- Run `npm run test:e2e:headed` to see browser actions

## Configuration

### Environment Variables

- `.env.example` - Template with all required variables
- `.env.local` - Local development configuration (auto-created)
- Production uses ECS task role authentication (no env vars needed)

### Optional: OpenAI Integration

Enable AI assistance features by configuring OpenAI:

```bash
OPENAI_ADMIN_KEY=sk-admin-xxxxx
OPENAI_PROJECT_ID=proj_xxxxx
```

**How It Works:**

- Service accounts are created automatically during interview creation
- Credentials are stored in DynamoDB interview records
- Service accounts are deleted automatically during interview destruction
- If not configured, interviews work normally without AI features

**Implementation Details:**

- `src/lib/openai.ts` - Service account management module
- `src/app/api/interviews/create/route.ts` - Creates service accounts
- `src/app/api/interviews/[id]/destroy/route.ts` - Deletes service accounts

### AWS Requirements

**Core Infrastructure**:

- ECS cluster for running interview instances
- Application Load Balancer for routing with health checks
- Route53 for DNS management and subdomain routing
- VPC with public/private subnets and security groups

**Storage and Processing**:

- S3 buckets for challenge storage and Terraform state
- Lambda functions for SOCI container indexing
- CloudWatch for logging and monitoring

**Security and Access**:

- IAM roles with least-privilege permissions
- ECS task roles for secure AWS API access
- ALB security groups for controlled access

## Deployment

### Production Deployment

The portal is designed to run on AWS ECS:

1. **Build Docker Image**:

   ```bash
   docker build -t prequel-portal .
   ```

2. **Deploy to ECS** with:
   - Task role with ECS, ELB, Route53 permissions
   - Environment: `NODE_ENV=production`
   - No AWS_PROFILE needed (uses ECS metadata service)

### Build and Deploy Script

```bash
./build-push-deploy.sh
```

This script:

1. Builds production Docker image
2. Pushes to ECR repository
3. Updates ECS service with new image
4. Waits for deployment completion

## Troubleshooting

### Common Issues

**Tests failing locally**:

- Run `npm install` to ensure dependencies are installed
- For E2E tests: `npx playwright install` to install browsers
- Check `portal/TESTING.md` for detailed debugging guide

**AWS authentication errors**:

- Run `aws sso login --profile <AWS_PROFILE>`
- Set `export AWS_PROFILE=<AWS_PROFILE>`
- Restart development server after authentication

**Build failures**:

- Run `npm run format` to fix formatting issues
- Run `npm run lint` to identify code quality issues
- Check TypeScript errors in IDE or build output

**Polling Issues**:

- Check browser DevTools > Network for `/api/interviews` requests
- Verify requests return 200 status every second
- Check for JavaScript errors in Console tab

### Development Tips

- Use `test:quick` for regular development
- Use `test:watch` for TDD workflow
- Only run `test:all` before important commits/PRs
- Use `test.only()` to focus on specific failing tests

### Getting Help

1. Check this README for API and development guidance
2. Review existing tests for implementation examples
3. Use `npm run test:e2e:ui` for interactive E2E debugging
4. Check CloudWatch logs for production issues

## Contributing

1. Run `npm run test:quick` before every commit
2. Run `npm run test:all` before creating PRs
3. Follow the existing code style (enforced by Prettier)
4. Add tests for new features
5. Update documentation as needed

The project emphasizes local testing over CI/CD for faster development feedback.
