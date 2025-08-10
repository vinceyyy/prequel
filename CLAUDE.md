# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prequel is a coding interview platform that provisions on-demand VS Code instances in the browser for candidates. Features include:

- **Enhanced Challenge Management**: Drag-and-drop file/folder uploads with `.vscode` support and automatic dependency installation
- **Scheduled Interviews**: Create interviews for future execution with configurable auto-destroy timers
- **Real-time Updates**: Live SSE-powered status updates without manual refresh
- **Background Operations**: Non-blocking interview creation and destruction with detailed logs
- **Auto-destroy Protection**: Mandatory resource cleanup to prevent AWS cost overruns
- **File History Management**: Save and download candidate files with smart error handling
- **AWS Resource Cleanup**: Comprehensive system to identify and clean up dangling resources

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
- Persistent operation storage in DynamoDB with automatic cleanup via TTL

**Scheduling System:**
- Built-in scheduler running within NextJS container (no external dependencies)
- Processes scheduled interviews and auto-destroy timeouts using DynamoDB GSI queries
- Mandatory auto-destroy prevents forgotten resources with duplicate prevention
- Configurable durations: 30min, 45min, 1hr, 1.5hr, 2hr, 3hr, 4hr
- Efficient operation lookup using DynamoDB Global Secondary Indexes

**Resource Cleanup System:**
- Automated detection of dangling terraform workspaces and AWS resources
- Multi-interface access: Web UI (Admin tab), REST API, and optional CLI script
- Safety features: dry-run mode, concurrency control, skip active interviews
- Comprehensive error handling for S3, DynamoDB, and terraform operations

## Architecture

- **`infra/`** - Shared AWS infrastructure (VPC, ECS, ALB, DynamoDB) via Terraform
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

**Cleanup Operations:**

```bash
# Server-side cleanup script (optional)
node cleanup-resources.js   # Interactive CLI for resource cleanup

# Web-based cleanup via Admin tab in portal
# - Access cleanup dashboard at portal Admin tab
# - Preview dangling resources before cleanup
# - One-click cleanup with safety features
# - Real-time progress monitoring

# API-based cleanup for automation
curl "http://localhost:3000/api/admin/cleanup"                    # List resources
curl -X POST "http://localhost:3000/api/admin/cleanup"           # Clean up resources
curl -X POST "http://localhost:3000/api/admin/cleanup?dryRun=true"  # Preview only
```

**File Extraction Requirements:**

The file saving feature requires AWS Session Manager plugin for container access:

**For Local Development:**
```bash
# Install Session Manager plugin (required for file extraction)
# macOS (Homebrew)
brew install --cask session-manager-plugin

# Ubuntu/Debian
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
sudo dpkg -i session-manager-plugin.deb

# Amazon Linux 2
sudo yum install -y session-manager-plugin

# Verify installation
session-manager-plugin --version
```

**For ECS Deployment:**
The portal Docker image has been updated to include the Session Manager plugin. The installation is handled in `portal/Dockerfile` using RPM extraction for Alpine Linux compatibility:

```dockerfile
# Install AWS Session Manager plugin (already included in portal/Dockerfile)
RUN apk add --no-cache wget unzip aws-cli curl rpm2cpio cpio
RUN curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm" -o "session-manager-plugin.rpm" \
    && mkdir -p /tmp/ssm \
    && cd /tmp/ssm \
    && rpm2cpio ../session-manager-plugin.rpm | cpio -idmv \
    && cp usr/local/sessionmanagerplugin/bin/session-manager-plugin /usr/local/bin/ \
    && chmod +x /usr/local/bin/session-manager-plugin \
    && cd / \
    && rm -rf /tmp/ssm session-manager-plugin.rpm
```

**Infrastructure Setup:**
- ECS task definition has `enable_execute_command = true` for code-server containers
- Portal ECS task role includes SSM permissions for execute command
- Interview containers are configured to allow ECS Execute Command

Without the plugin, file extraction will be skipped and interviews will still destroy successfully.

**Infrastructure:**

```bash
cd infra
terraform init -backend-config=backend.config  # Initialize with backend config
terraform plan   # Plan infrastructure changes
terraform apply  # Deploy infrastructure (includes automated portal image building)
terraform destroy # Clean up resources
```

**ECS Portal Bootstrapping:**

The infrastructure now includes automated portal Docker image building and pushing during Terraform deployments:

- **`infra/bootstrap-portal-image.sh`** - Script for building and pushing portal Docker image to ECR
- **Cross-platform builds** - Uses Docker Buildx for AMD64 (ECS compatibility)
- **Automatic triggering** - Runs during Terraform apply via `null_resource` provisioner
- **Environment integration** - Passes all necessary environment variables from Terraform

## Local Development

**Environment Setup:**

1. **Project Configuration:**
   ```bash
   # Copy environment template
   cp .env.example .env.local
   # Edit .env.local with your AWS configuration:
   # AWS_PROFILE=your-aws-profile
   # AWS_REGION=your-aws-region
   # LOG_LEVEL=debug  # Set to debug for verbose scheduler logging
   # PROJECT_PREFIX=your-project-prefix  # Must match deployed infrastructure
   # ENVIRONMENT=dev  # Must match infra/terraform.tfvars
   # DOMAIN_NAME=your-domain.com
   # Table names will be auto-generated: {PROJECT_PREFIX}-{ENVIRONMENT}-{table}
   ```

**⚠️ Critical: Configuration Consistency**

The portal now uses a **centralized configuration system** (`portal/src/lib/config.ts`) that automatically generates AWS resource names based on your environment variables. Your `.env.local` settings must match your deployed infrastructure:

- **DynamoDB Tables**: `{PROJECT_PREFIX}-{ENVIRONMENT}-interviews` and `{PROJECT_PREFIX}-{ENVIRONMENT}-operations`
- **S3 Buckets**: `{PROJECT_PREFIX}-{ENVIRONMENT}-challenge`, `{PROJECT_PREFIX}-{ENVIRONMENT}-instance`, `{PROJECT_PREFIX}-{ENVIRONMENT}-history`
- **ECS Cluster**: `{PROJECT_PREFIX}-{ENVIRONMENT}`

**AWS Authentication for Local Development:**

The portal automatically detects your deployment context and uses appropriate credentials:
- **Local Development**: Uses `AWS_PROFILE` with SSO credentials (`fromSSO()`)
- **ECS Deployment**: Uses IAM task roles automatically
- **Auto-detection**: Based on `AWS_EXECUTION_ENV` environment variable

2. **Infrastructure Configuration:**
   ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your deployment values
   
   cp backend.config.example backend.config
   # Edit backend.config with your S3 backend configuration
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

**⚠️ Important: Terraform Backend Configuration**

Before running `terraform init`, you must:
1. Create an S3 bucket for Terraform state (bucket name can be anything)
2. Configure the backend in `infra/backend.config`:
   
   **`infra/backend.config`**:
   ```hcl
   bucket       = "your-bucket-name"
   key          = "common"  # Optional: change if needed
   region       = "your-aws-region"
   use_lockfile = true
   ```

3. Initialize Terraform with backend configuration:
   ```bash
   cd infra
   terraform init -backend-config=backend.config
   ```

**Build Scripts:**

All build scripts automatically load environment variables from `.env.local`:

- `instance/build-and-push.sh` - Build and push instance Docker image
- `portal/build-push-deploy.sh` - Build, push and deploy portal
- `challenge/sync-to-s3.sh` - Sync challenges to S3

**Centralized Configuration System:**

The portal uses a type-safe configuration system (`portal/src/lib/config.ts`) that manages all environment variables:

- **AWS Config**: Credentials, region, deployment context detection
- **Database Config**: Auto-generated DynamoDB table names
- **Storage Config**: Auto-generated S3 bucket names with environment suffixes
- **Project Config**: Prefix, environment, domain settings
- **Auth Config**: Local development authentication settings
- **Runtime Config**: Browser/server, development/production detection

**Configuration Validation:**

The system validates that your local environment matches deployed infrastructure:
- Checks AWS credentials are available for your profile
- Validates table/bucket names match expected patterns
- Provides clear error messages for misconfigurations

**⚠️ Critical: Environment Consistency**

The `PROJECT_PREFIX` and `ENVIRONMENT` variables in `.env.local` MUST match your deployed infrastructure:

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
  - `src/lib/` - Core business logic (operations with DynamoDB, scheduler, terraform)
- `infra/` - Shared AWS infrastructure code in terraform (VPC, ECS, ALB, DynamoDB)
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
2. [X] **Create and manage challenges**
   1. [X] Upload challenge files and folders via drag-and-drop interface
   2. [X] Support for `.vscode` configuration folders and complex project structures  
   3. [X] Mixed file/folder uploads with automatic folder hierarchy preservation
   4. [X] Project structure guidelines with ASCII tree examples
   5. [X] Automatic dependency installation (package.json, pyproject.toml, requirements.txt)
   6. [X] Challenge deletion and resource management
   7. [X] Resource configuration display (CPU cores, RAM in GB, storage)
3. [X] **Create interview instances**
    1. [X] Manually create an instance immediately
    2. [X] Select from available challenges with CPU/memory/storage display
    3. [X] Schedule instance creation for future execution
    4. [X] **Mandatory**: Choose interview duration (30min-4hrs) with automatic destruction
    5. [X] Real-time status updates via SSE (no manual refresh needed)
4. [X] Wait for instance to become `Active`
   - [X] Challenge files are automatically copied from S3 during configuring stage
   - [X] Live status updates show progression through states
5. [X] Access active instance
   - [X] Copy URL and password from the portal
   - [X] Send credentials to candidate
6. [X] **Destroy instance and manage history**
    1. [X] Manual destruction via portal interface
    2. [X] **Automatic destruction** based on configured timeout
    3. [X] Background operations with detailed logs
    4. [X] Option to save candidate files to S3 during destruction
    5. [X] Download saved files from history tab with proper error handling
    6. [X] Smart download visibility based on `saveFiles` attribute
    7. [X] User-friendly error messages for download failures
7. [X] **Admin resource cleanup**
    1. [X] Comprehensive cleanup system for dangling AWS resources
    2. [X] Multi-interface access: Web UI (Admin tab), REST API, CLI script  
    3. [X] Safety features: dry-run preview, concurrency control, skip active interviews
    4. [X] Automatic detection of terraform workspaces without DynamoDB records
    5. [X] Graceful error handling for S3, DynamoDB, and terraform operations

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
