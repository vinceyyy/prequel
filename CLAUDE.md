# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prequel is a coding interview platform that provisions on-demand VS Code instances in the browser for candidates.

## Architecture

- **`infra/`** - Shared AWS infrastructure (VPC, ECS, ALB) via Terraform
- **`portal/`** - NextJS web interface for managing interviews
- **`instance/`** - Per-interview Terraform templates for ECS instances
- **`challenge/`** - Interview coding challenges and environments

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

**Environment Variables:**

Set these environment variables for AWS configuration:

```bash
export AWS_PROFILE=your-profile-name    # AWS profile to use
export AWS_REGION=your-aws-region             # AWS region (default: your-aws-region)
```

**Portal Setup:**

1. Configure AWS SSO: `aws configure sso --profile <AWS_PROFILE>`
2. Login to AWS: `aws sso login --profile <AWS_PROFILE>`
3. Copy environment file: `cp portal/.env.example portal/.env.local`
4. Set AWS profile: `export AWS_PROFILE=<AWS_PROFILE>`
5. Start portal: `cd portal && npm run dev`

**Build Scripts:**

All build scripts use environment variables for AWS configuration:

- `instance/build-and-push.sh` - Build and push instance Docker image
- `instance/terraform/sync-to-s3.sh` - Sync instance terraform code to S3
- `portal/build-push-deploy.sh` - Build, push and deploy portal
- `challenge/sync-to-s3.sh` - Sync challenges to S3

**Interview Deployment:**

- Uses ECS IAM task roles for AWS authentication
- No need for AWS_PROFILE or SSO in production
- Credentials provided automatically via ECS metadata service

Access at http://localhost:8443 with password "password"

## Project Structure

Current structure:

- `portal/` - NextJS frontend
- `infra/` - Shared AWS infrastructure code in terraform
- `instance/` - Terraform code for provisioning code-server instance
- `challenge/` - Interview challenge files

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

## Desired User Flow

The checkbox indicates features to support the action is already built.

1. [ ] Login to portal
2. [ ] Create instance
    1. [X] The user can manually create an instance
    2. [X] Select a challenge (prebuilt or customized)
    3. [ ] Optionally, selecting instance if the user needs special instance
    4. [ ] The user can also schedule an instance creation at a specific time to avoid waiting for the instance to spin
       up
3. [X] Wait for instance to become `Active` - Challenge files will be copied from S3 to instance during the configuring
   stage
4. [X] When an instance become `Active`, the user can copy the URL and password and send to the candidate
5. [ ] Destroy the instance after an interview
    1. [ ] The user can manually destroy the instance after the interview
    2. [ ] The user can also schedule an instance destroy at a specific time to ensure cleanup
    3. [ ] Option to save all files (with ignore list) to s3, into candidate-named folder

## Instance Status

1. Initializing - provisioning infra, not customizable by the user when creating instance
2. Configuring
    - Wait for the ECS container to boot up
    - Install extra extensions - customizable by the user when creating the instance (basic extensions are already built
      into the image)
    - Copy in settings.json - customizable by the user when creating the instance
    - Copy in challenge files and set workspace (work DIR) - customizable by the user when creating the instance
    - Wait for code-server to start
3. Active - Code-server up and running, allow for incoming connections
4. Destroying
    - Destroy all infrastructures
    - Delete terraform workspace files on S3
5. Error
