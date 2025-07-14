# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prequel is a coding interview platform that provisions on-demand VS Code instances in the browser for candidates. Features include:

- **Scheduled Interviews**: Create interviews for future execution with configurable auto-destroy timers
- **Real-time Updates**: Live SSE-powered status updates without manual refresh
- **Background Operations**: Non-blocking interview creation and destruction with detailed logs
- **Auto-destroy Protection**: Mandatory resource cleanup to prevent AWS cost overruns

## Real-time Architecture

**Server-Sent Events (SSE) System:**
- `/api/events` - SSE endpoint providing real-time updates
- `OperationManager` - Emits events on all operation status changes
- `SchedulerService` - 30-second polling for scheduled operations with event emission
- `useSSE` hook - Client-side SSE connection with auto-reconnection
- Live status indicator in UI showing connection health

**Background Operations:**
- All interview creation/destruction happens in background
- Detailed operation logs with streaming updates
- Non-blocking UI - users can continue working while operations run
- Persistent operation storage in `/tmp/${PROJECT_PREFIX}-operations.json`

**Scheduling System:**
- Built-in scheduler running within NextJS container (no external dependencies)
- Processes scheduled interviews and auto-destroy timeouts
- Mandatory auto-destroy prevents forgotten resources
- Configurable durations: 30min, 45min, 1hr, 1.5hr, 2hr, 3hr, 4hr

## Architecture

- **`infra/`** - Shared AWS infrastructure (VPC, ECS, ALB) via Terraform
- **`portal/`** - NextJS web interface with real-time SSE updates for managing interviews
- **`instance/`** - Per-interview Terraform templates for ECS instances
- **`challenge/`** - Interview coding challenges and environments stored in S3

## Development Commands

**Portal (NextJS):**

```bash
cd portal
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run format:check # Check code formatting

# Testing (Local Development Focus)
npm run test:quick   # Quick pre-commit tests (recommended)
npm run test:all     # Full test suite before PR
npm run test:dev     # Watch mode for development

# Individual test types
npm run test         # Unit tests only
npm run test:e2e     # E2E tests only
npm run test:coverage # Coverage report
```

**Infrastructure:**

```bash
cd infra
terraform plan   # Plan infrastructure changes
terraform apply  # Deploy infrastructure
terraform destroy # Clean up resources
```

## Local Development

**Environment Setup:**

1. **Project Configuration:**
   ```bash
   # Copy environment template
   cp .env.example .env.local
   # Edit .env.local with your AWS configuration:
   # AWS_PROFILE=your-aws-profile
   # AWS_REGION=your-aws-region
   # PROJECT_PREFIX=prequel
   # DOMAIN_NAME=your-domain.com
   ```

2. **Infrastructure Configuration:**
   ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your deployment values
   ```

3. **AWS Setup:**
   ```bash
   aws configure sso --profile <your-aws-profile>
   aws sso login --profile <your-aws-profile>
   ```

4. **Start Development:**
   ```bash
   cd portal && npm run dev
   ```

**⚠️ Important: Terraform Backend Bucket**

Before running `terraform init`, you must:
1. Create an S3 bucket for Terraform state (bucket name can be anything)
2. Update backend configuration in **TWO** files:
   
   **`infra/main.tf`** (lines 11-13):
   ```hcl
   backend "s3" {
     bucket = "your-bucket-name"
     key    = "your-project-key"  # Optional: defaults to "common"
     region = "your-aws-region"
   }
   ```

   **`infra/terraform.tfvars`**:
   ```hcl
   terraform_state_bucket = "your-bucket-name"  # Must match above
   ```

**Build Scripts:**

All build scripts automatically load environment variables from `.env.local`:

- `instance/build-and-push.sh` - Build and push instance Docker image
- `portal/build-push-deploy.sh` - Build, push and deploy portal
- `challenge/sync-to-s3.sh` - Sync challenges to S3

**Configuration Notes:**

- `PROJECT_PREFIX` defaults to "prequel" but can be customized for different deployments
- `ENVIRONMENT` defaults to "dev" but can be set to "staging", "prod", etc. 
- All AWS resources (S3 buckets, ECS clusters, etc.) use the project prefix and environment for naming
- `.env.local` is gitignored and contains your personal configuration (located at project root)
- `.env.example` shows the required configuration structure (located at project root)
- All build scripts automatically load environment variables from the root `.env.local`

**⚠️ Critical: Environment Consistency**

The `ENVIRONMENT` variable in `.env.local` MUST match the `environment` variable in `infra/terraform.tfvars`:

```bash
# .env.local
ENVIRONMENT=prod

# infra/terraform.tfvars  
environment = "prod"
```

If these don't match, build scripts will try to deploy to `{PROJECT_PREFIX}-{ENVIRONMENT}` resources that don't exist.

**Deployment Contexts:**

- **Local development**: Uses AWS SSO profiles (requires `aws sso login`)
- **ECS deployment**: Uses ECS IAM task roles (any environment: dev/staging/prod)
- **Credential detection**: Automatically detects ECS vs local via `AWS_EXECUTION_ENV`
- **No manual configuration**: Credentials handled automatically per context

Access at http://localhost:8443 with password "password"

## Project Structure

Current structure:

- `portal/` - NextJS frontend with SSE real-time updates
  - `src/app/` - Next.js app router pages and API routes
  - `src/components/` - Reusable React components
  - `src/hooks/` - Custom React hooks (useSSE, useOperations)
  - `src/lib/` - Core business logic (operations, scheduler, terraform)
- `infra/` - Shared AWS infrastructure code in terraform
- `instance/` - Terraform code for provisioning code-server instance
- `challenge/` - Interview challenge files stored in S3

## Code Style

**Portal TypeScript/React:**

- **Prettier**: Automatic code formatting (single quotes, no semicolons, 80 char width). Always run after changes.
- **ESLint**: Code quality rules with NextJS and TypeScript support. Use ES6 syntax. Always run after changes.
- **Tailwind**: Use tailwind classes instead of inline styles as much as possible
- **Commands**: `npm run format` to format all files. `npm run build` to build the app.

## Development Guidelines

- ALWAYS run `npm run test:quick` before committing
- ALWAYS run linter and formatter after changes
- ALWAYS make sure the app can be built without error
- DO NOT deploy to production without explicit consent
- Use conventional commit messages

## Local Testing Workflow

**During Development:**

```bash
npm run test:dev     # Watch mode - tests run automatically
```

**Before Committing:**

```bash
npm run test:quick   # Fast validation (2-3 minutes)
```

**Before Creating PR:**

```bash
npm run test:all     # Full test suite (5-10 minutes)
```

**Testing Documentation:**

- `CONTRIBUTING.md` - Development workflow, testing, and contribution guidelines
- `portal/TESTING.md` - Comprehensive testing guide
- `portal/README.md` - Portal-specific documentation

**Debugging Tests:**

- Unit tests: Use `test.only()` to focus on specific tests
- E2E tests: Use `npm run test:e2e:ui` for interactive debugging
- Coverage reports: `npm run test:coverage`

## User Flow

The checkbox indicates features that are currently implemented.

1. [X] Login to portal
2. [X] Create instance
    1. [X] Manually create an instance immediately
    2. [X] Select a challenge from S3-stored options (javascript, python, sql, etc.)
    3. [X] Schedule instance creation for future execution
    4. [X] **Mandatory**: Choose interview duration (30min-4hrs) with automatic destruction
    5. [X] Real-time status updates via SSE (no manual refresh needed)
3. [X] Wait for instance to become `Active`
   - [X] Challenge files are automatically copied from S3 during configuring stage
   - [X] Live status updates show progression through states
4. [X] Access active instance
   - [X] Copy URL and password from the portal
   - [X] Send credentials to candidate
5. [X] Destroy instance
    1. [X] Manual destruction via portal interface
    2. [X] **Automatic destruction** based on configured timeout
    3. [X] Background operations with detailed logs
    4. [ ] Option to save candidate files to S3 (not yet implemented)

## Instance Status

**Live status updates via Server-Sent Events (SSE) - no manual refresh required**

1. **Scheduled** - Interview scheduled for future execution
   - Displayed with scheduled start time and auto-destroy time
   - Purple status indicator in UI

2. **Initializing** - Provisioning AWS infrastructure (not customizable)
   - Terraform creating ECS service, ALB target group, etc.
   - Blue status indicator in UI

3. **Configuring** - Setting up VS Code environment
   - ECS container booting up
   - Installing extensions (basic extensions built into image)
   - Copying challenge files from S3 to workspace
   - Starting code-server service
   - Yellow status indicator in UI

4. **Active** - Ready for candidate access
   - Code-server running and accepting connections
   - URL and password available for sharing
   - Green status indicator in UI

5. **Destroying** - Cleaning up resources
   - Destroying all AWS infrastructure
   - Deleting terraform workspace files from S3
   - Orange status indicator in UI

6. **Error** - Something went wrong
   - Resources may need manual cleanup
   - Retry destroy option available
   - Red status indicator in UI

**Status changes trigger immediate SSE events for real-time UI updates**
