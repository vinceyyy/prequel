# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prequel is a coding interview platform that provisions on-demand VS Code instances in the browser for candidates. Features include:

- **Enhanced Challenge Management**: Drag-and-drop file/folder uploads with `.vscode` support and automatic dependency installation
- **Scheduled Interviews**: Create interviews for future execution with configurable auto-destroy timers
- **Real-time Updates**: 1-second polling for live status updates without manual refresh
- **Background Operations**: Non-blocking interview creation and destruction with detailed logs
- **Auto-destroy Protection**: Mandatory resource cleanup to prevent AWS cost overruns
- **File History Management**: Save and download candidate files with smart error handling
- **AWS Resource Cleanup**: Comprehensive system to identify and clean up dangling resources
- **API Key Manager**: Standalone OpenAI API key provisioning with immediate, scheduled, or candidate-activated modes

## Real-time Architecture

**Polling System:**
- 1-second interval polling for interviews, take-homes, and API keys
- `useInterviewPolling` / `useTakeHomePolling` / `useApiKeyPolling` hooks for state-based polling
- `useOperationPolling` hook for toast notifications
- Server-side merging of operation status into interview/take-home state
- Live status indicator in UI showing Active/Idle state

**Background Operations:**
- All interview creation/destruction happens in background
- Detailed operation logs with streaming updates
- Non-blocking UI - users can continue working while operations run
- Persistent operation storage in DynamoDB with automatic cleanup via TTL

**Scheduling System:**
- Built-in scheduler running within NextJS container (no external dependencies)
- Processes scheduled interviews, auto-destroy timeouts, and API key lifecycle using DynamoDB GSI queries
- **Pre-provisioning**: Starts provisioning 5 minutes before scheduled time to ensure instances are ready exactly when needed
- Mandatory auto-destroy prevents forgotten resources with duplicate prevention
- Configurable durations: 30min, 45min, 1hr, 1.5hr, 2hr, 3hr, 4hr (interviews), up to 7 days (API keys)
- Efficient operation lookup using DynamoDB Global Secondary Indexes
- 30-second polling interval for reliable scheduling

**Resource Cleanup System:**
- Automated detection of dangling terraform workspaces and AWS resources
- Multi-interface access: Web UI (Admin tab), REST API, and optional CLI script
- Safety features: dry-run mode, concurrency control, skip active interviews
- Comprehensive error handling for S3, DynamoDB, and terraform operations

## Architecture

- **`infra/`** - AWS infrastructure via Terraform
  - **`infra/environments/shared/`** - Shared networking resources (VPC, subnets, security groups)
  - **`infra/environments/dev/`** - Development environment (DynamoDB, S3, ECS, ALB, DNS)
  - **`infra/environments/prod/`** - Production environment (DynamoDB, S3, ECS, ALB, DNS)
  - **`infra/modules/`** - Reusable Terraform modules (networking, storage, compute, dns)
- **`portal/`** - NextJS web interface with real-time polling for managing interviews
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
cd infra/environments/{environment}  # shared, dev, or prod
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

## Production Deployment

The infrastructure supports multiple environments with shared networking resources for cost efficiency and simplified management.

**Multi-Environment Architecture:**

The project uses a three-tier environment structure:

1. **Shared Infrastructure** (`infra/environments/shared`)
   - VPC, subnets, internet gateway, NAT gateway
   - Security groups for ECS tasks and ALB
   - Shared across all environments (dev, prod, staging)
   - Deployed once, referenced by environment-specific configurations

2. **Development Environment** (`infra/environments/dev`)
   - DynamoDB tables, S3 buckets, ECS cluster, ALB
   - Domain: `interview-dev.example.com` (or your dev domain)
   - Used for testing and development
   - Isolated from production data

3. **Production Environment** (`infra/environments/prod`)
   - DynamoDB tables, S3 buckets, ECS cluster, ALB
   - Domain: `interview.example.com` (or your prod domain)
   - Production-ready configuration
   - Isolated from development data

**Environment Separation:**

Each environment has completely isolated:
- DynamoDB tables (`{PREFIX}-{ENV}-interviews`, `{PREFIX}-{ENV}-operations`, `{PREFIX}-{ENV}-challenges`, `{PREFIX}-{ENV}-apikeys`)
- S3 buckets (`{PREFIX}-{ENV}-challenge`, `{PREFIX}-{ENV}-instance`, `{PREFIX}-{ENV}-history`)
- ECS clusters and services (`{PREFIX}-{ENV}`)
- ALB and target groups
- Route53 hosted zones and DNS records

**Deploying to Production:**

1. **Prerequisites:**
   - AWS SSO configured and logged in
   - S3 bucket for Terraform state created
   - Domain DNS delegated to Route53
   - OpenAI credentials (optional, for AI features)

2. **Deploy Shared Infrastructure (one-time):**
   ```bash
   cd infra/environments/shared
   terraform init -backend-config=backend.config
   terraform plan
   terraform apply
   ```

3. **Deploy Production Environment:**
   ```bash
   cd ../prod
   terraform init -backend-config=backend.config
   terraform plan
   terraform apply
   ```

4. **Wait for Certificate Validation:**
   - ACM certificate validation can take 5-30 minutes
   - DNS records are automatically created for validation
   - Monitor: `terraform output certificate_arn`

5. **Build and Push Portal Image:**
   ```bash
   cd ../../../portal

   # Get ECR repository URL
   export ECR_REPO_URL=$(cd ../infra/environments/prod && terraform output -raw ecr_repository_url)

   # Authenticate to ECR
   aws ecr get-login-password --region us-east-1 --profile your-profile | \
     docker login --username AWS --password-stdin $ECR_REPO_URL

   # Build and push
   docker build --platform linux/amd64 -t $ECR_REPO_URL:latest .
   docker push $ECR_REPO_URL:latest
   ```

6. **Verify Deployment:**
   - Check ECS service is running: `aws ecs describe-services ...`
   - Test HTTPS access: `curl -I https://your-domain.com`
   - Login to portal and verify functionality

**Bug Fixes in Production Deployment:**

During the production deployment, two critical bugs were identified and fixed:

1. **ALB Target Group Naming Conflict** (`infra/modules/compute/main.tf`)
   - Issue: Target group name limited to 32 characters, but was exceeding limit
   - Fix: Changed from `{prefix}-portal` to `{prefix}-{env}-portal` with proper truncation
   - Ensures unique names across environments while respecting AWS limits

2. **HTTPS Listener Condition Priority** (`infra/modules/compute/main.tf`)
   - Issue: HTTPS listener was not properly configured with host-based routing
   - Fix: Added explicit listener rule with host header condition and priority
   - Ensures traffic is correctly routed to portal target group

**Production URLs:**

- Development: `https://interview-dev.example.com` (or your configured dev domain)
- Production: `https://interview.example.com` (or your configured prod domain)

**Configuration Files:**

Each environment requires two configuration files:

1. **`terraform.tfvars`** - Environment-specific values
   ```hcl
   project_prefix  = "your-project"
   environment     = "prod"
   aws_region      = "us-east-1"
   domain_name     = "interview.example.com"
   enable_auth     = true
   auth_passcode   = "secure-passcode"
   openai_admin_key = "sk-admin-xxx"  # optional
   openai_project_id = "proj_xxx"     # optional
   ```

2. **`backend.config`** - Terraform state backend
   ```hcl
   bucket = "your-terraform-state-bucket"
   key    = "environments/prod/terraform.tfstate"
   region = "us-east-1"
   ```

**Local Development Against Production:**

To test against production resources locally (use with caution):

```bash
# .env.local
AWS_REGION=us-east-1
AWS_PROFILE=your-aws-profile
PROJECT_PREFIX=your-project-prefix
ENVIRONMENT=prod  # Change to prod
DOMAIN_NAME=interview.example.com
```

Warning: Be extremely careful when running local development against production - you're working with real production data and resources.

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

5. **OpenAI Integration (Optional):**

   If you want to enable AI assistance features in interviews and the API Key Manager:

   1. Get an OpenAI Admin API key from https://platform.openai.com/
   2. Create a project and get the project ID
   3. Add to `.env.local`:
      ```bash
      OPENAI_ADMIN_KEY=sk-admin-xxxxx
      OPENAI_PROJECT_ID=proj_xxxxx
      ```

   **How It Works:**
   - When interview/take-home/API key is created, a service account is created via OpenAI API
   - Service account credentials are stored in DynamoDB (interview, take-home, or apikeys table)
   - When resource expires or is destroyed, the service account is automatically deleted
   - If OpenAI is not configured, interviews/take-homes work normally without AI features; API Key Manager requires OpenAI

   **Service Account Naming Convention:**
   - Format: `interview-<env>-<type>-<id>-<name>`
   - Examples: `interview-prod-interview-abc123-Jesse`, `interview-dev-apikey-xyz789-Vincent`

   **Implementation:**
   - `portal/src/lib/openai.ts` - OpenAI service account management (create, delete, list)
   - `portal/src/lib/apikeys.ts` - API Key Manager DynamoDB operations
   - `portal/src/lib/apiKeyListService.ts` - Unified API key listing with orphan detection
   - `portal/src/app/api/apikeys/` - API Key Manager endpoints
   - `portal/src/app/apikey/[token]/` - Candidate-facing activation page

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

All build scripts support multi-environment deployment with optional environment parameter:

- `instance/build-and-push.sh [environment]` - Build and push instance Docker image
- `portal/build-push-deploy.sh [environment]` - Build, push and deploy portal
- `challenge/sync-to-s3.sh [environment]` - Sync challenges to S3
- `instance/terraform/sync-to-s3.sh [environment]` - Sync instance templates to S3

**Usage:**
```bash
# Deploy to specific environment
./build-and-push.sh prod

# Deploy to environment from .env.local (backward compatible)
./build-and-push.sh
```

The `environment` parameter can be `dev`, `prod`, or `staging`. If not provided, scripts fall back to the `ENVIRONMENT` variable from `.env.local`.

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

- `portal/` - NextJS frontend with real-time polling
  - `src/app/` - Next.js app router pages and API routes
  - `src/components/` - Reusable React components
  - `src/hooks/` - Custom React hooks (usePolling, useOperations)
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
    5. [X] Real-time status updates via polling (no manual refresh needed)
    6. [X] **Pre-provisioning**: Scheduled interviews automatically start 5 minutes early to be ready at scheduled time
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
8. [X] **API Key Manager**
    1. [X] Create standalone OpenAI API keys with configurable duration (up to 7 days)
    2. [X] Three activation modes: immediate, scheduled, or candidate-activated (recipient shares link)
    3. [X] Unified view of all API keys (standalone + interview + take-home keys)
    4. [X] Orphan detection: identifies OpenAI service accounts without matching records
    5. [X] Automatic expiration and cleanup via scheduler
    6. [X] Rate limit info banner showing shared token quotas across all keys
    7. [X] Copy Key button for active keys, Copy Link for candidate-activated keys

## Instance Status

**Live status updates via 1-second polling - no manual refresh required**

1. **Scheduled** - Interview scheduled for future execution
   - Displayed with scheduled start time and auto-destroy time
   - Purple status indicator in UI
   - **Pre-provisioning**: Provisioning begins 5 minutes before scheduled time
   - Instance will be Active and ready at the exact scheduled time

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

**Status changes are picked up by polling for real-time UI updates**

## Scheduled Interview Timing

**Pre-provisioning Strategy:**
Scheduled interviews use a pre-provisioning strategy to ensure instances are ready exactly at the scheduled time.

**Timeline Example:**
If you schedule an interview for **2:00 PM**:
- **1:55 PM** - Scheduler detects it's time to start (5 minutes early)
- **1:55 PM** - Status changes from `Scheduled` to `Initializing` (Terraform provisioning begins)
- **1:57 PM** - Status changes to `Configuring` (ECS container boots, files copied)
- **1:58-2:00 PM** - Status changes to `Active` (ready for candidate access)
- **Result**: Instance is accessible exactly at 2:00 PM ✅

**How It Works:**
1. Scheduler runs every 30 seconds checking for scheduled operations
2. Provisioning begins when: `current_time >= (scheduled_time - 5 minutes)`
3. Infrastructure takes ~3-5 minutes to provision and configure
4. Instance becomes Active at or slightly before the scheduled time

**Benefits:**
- ✅ Candidates can access immediately at scheduled time (no waiting)
- ✅ Predictable timing for coordinated interviews
- ✅ Better user experience compared to waiting after scheduled time
- ✅ URL and password displayed immediately when scheduling

**Implementation:**
- Located in `portal/src/lib/scheduler.ts:processScheduledOperations()`
- Calculates: `provisioningTime = scheduledAt - 5 minutes`
- Detailed logging shows provisioning timeline and countdown
