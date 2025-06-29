# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prequel is a coding interview tool that provisions VS Code instances on AWS ECS for candidates. The project is in early development stage with only basic configuration files present.

## Current Architecture

- **Frontend**: NextJS portal (planned, not yet implemented)
- **Infrastructure**: Terraform for AWS resource management (planned, not yet implemented) 
- **Runtime**: Code-server instances on AWS ECS using Docker
- **Development**: VS Code/code-server with Docker Compose for local development

## Technology Stack

- **Frontend**: NextJS portal
- **Backend**: Node.js with Terraform integration
- **Infrastructure**: Terraform + AWS ECS
- **Development Tools**: Docker, VS Code, Prettier

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
cd terraform
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

**Code-server (for testing):**
```bash
docker-compose up
```
Access at http://localhost:8443 with password "password"

## Project Structure

Currently minimal structure:
- `docker-compose.yml` - Code-server configuration
- `.idea/misc.xml` - Prettier (manual mode, run on save) and Ruff (global) configurations
- No source code directories exist yet

Current structure:
- `portal/` - NextJS frontend
- `terraform/` - AWS infrastructure code  
- `scenarios/` - Interview scenario files

## Code Style

**Portal TypeScript/React:**
- **Prettier**: Automatic code formatting (single quotes, no semicolons, 80 char width)
- **ESLint**: Code quality rules with NextJS and TypeScript support
- **Format on save**: Recommended in VS Code
- **Commands**: `npm run format` to format all files

## Key Features (Planned)

- Per-candidate VS Code instance provisioning
- Password-protected access to instances
- Scenario-based file mounting (CSV for data science, DuckDB for SQL interviews)
- AWS ECS-based deployment with automatic teardown