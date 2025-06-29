# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prequel is a coding interview tool that provisions VS Code instances on AWS ECS for candidates. The project is in the
early development stage with only basic configuration files present.

## Current Architecture

- **Infrastructure**: Terraform for shared AWS resource management
- **Portal**: NextJS portal
- **instance**: Code-server instances on AWS ECS using Docker
- **scenario**: files that can be used to create EFS and mounted to instance as volume

## Development Commands

**Portal (NextJS):**

```bash
cd portal
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run format:check # Check code formatting
```

**Infrastructure:**

```bash
cd infra
terraform plan   # Plan infrastructure changes
terraform apply  # Deploy infrastructure
terraform destroy # Clean up resources
```

## Local Development

**Portal Setup:**

1. Configure AWS SSO: `aws configure sso --profile your-aws-profile`
2. Login to AWS: `aws sso login --profile your-aws-profile`
3. Copy environment file: `cp portal/.env.example portal/.env.local`
4. Set AWS profile: `export AWS_PROFILE=your-aws-profile`
5. Start portal: `cd portal && npm run dev`

**Production Deployment:**

- Uses ECS IAM task roles for AWS authentication
- No need for AWS_PROFILE or SSO in production
- Credentials provided automatically via ECS metadata service

Access at http://localhost:8443 with password "password"

## Project Structure

Current structure:

- `portal/` - NextJS frontend
- `infra/` - Shared AWS infrastructure code in terraform
- `instance/` - Terraform code for provisioning code-server instance
- `scenarios/` - Interview scenario files

## Code Style

**Portal TypeScript/React:**

- **Prettier**: Automatic code formatting (single quotes, no semicolons, 80 char width)
- **ESLint**: Code quality rules with NextJS and TypeScript support
- **Tailwind**: Use tailwind classes instead of inline styles as much as possible
- **Commands**: `npm run format` to format all files. `npm run build` to build the app.

## Development Guidelines

- ALWAYS run linter and formatter after change.
- ALWAYS make sure the app can be built without error
- DO NOT deploy without explicit consent
- ALWAYS run linter and formatter after change
- Use conventional commit

## Key Features (Planned)

- [X] Per-candidate VS Code instance provisioning
- [ ] Password-protected access to instances
- [ ] Scenario-based file mounting (CSV for data science, DuckDB for SQL interviews)
- [ ] AWS ECS-based deployment with automatic teardown

