# Prequel

A platform for conducting coding interviews using on-demand VS Code instances in the browser.

## Quick Start

### Prerequisites

- AWS account with appropriate permissions
- Node.js (>= 18), Terraform (>= 1.0)
- AWS CLI configured with SSO profile `<AWS_PROFILE>`

### Setup

```bash
# 1. Clone and install
git clone <repository-url>
cd prequel/portal
npm install

# 2. Configure AWS
aws configure sso --profile <AWS_PROFILE>
aws sso login --profile <AWS_PROFILE>
export AWS_PROFILE=<AWS_PROFILE>

# 3. Start development
npm run dev          # Development server at http://localhost:3000
npm run test:dev     # Continuous testing (recommended)
```

## Architecture

```
prequel/
├── infra/           # Shared AWS infrastructure (Terraform)
├── portal/          # NextJS web interface  
├── instance/        # Per-interview Terraform templates
└── scenario/        # Interview coding challenges
```

**Tech Stack:** Next.js + TypeScript, AWS ECS, Terraform

## Features

- **On-demand instances** - Isolated VS Code containers per candidate
- **Pre-configured scenarios** - JavaScript, Python, SQL
- **Automatic provisioning** - Infrastructure created/destroyed via Terraform
- **Secure access** - Password-protected with temporary credentials
- **Cost-effective** - Resources only run during interviews (~$0.50/hour)

## Usage

### Running the Application

```bash
cd portal/
npm run dev          # Start development server
```

Access the portal at http://localhost:3000 to:

- Create new coding interviews
- Monitor interview status
- Manage VS Code instances
- Access interview logs

### Basic Commands

```bash
# Application
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server

# Quality checks
npm run lint         # Code quality check
npm run format       # Fix code formatting
```

**📚 Developer Resources:**

- `CONTRIBUTING.md` - Development setup, testing, code guidelines
- `portal/TESTING.md` - Detailed testing documentation

## Interview Flow

1. **Create Interview** - Select candidate name + scenario type
2. **Auto-provision** - Terraform creates isolated ECS instance
3. **Share access** - Portal provides URL + password
4. **Conduct interview** - Candidate codes in browser VS Code
5. **Cleanup** - All resources automatically destroyed

## Available Scenarios

| Scenario         | Tools                  | Challenge Type           |
|------------------|------------------------|--------------------------|
| **JavaScript**   | React, TypeScript      | Todo list implementation |
| **Python**       | Pandas, NumPy, Jupyter | Data analysis tasks      |
| **SQL/Database** | SQLite, sample data    | Complex queries          |
| **Full Stack**   | React + Node.js        | Complete app development |

## Production Deployment

### Infrastructure Setup

```bash
cd infra/
terraform init
cp terraform.tfvars.example terraform.tfvars
# Configure domain_name in terraform.tfvars
terraform apply
```

### Portal Deployment

The portal runs on AWS ECS with:

- ECS Task Role (no AWS_PROFILE needed)
- Environment: `NODE_ENV=production`
- Auto-scaling based on demand

## Project Structure Details

### Component Responsibilities

- **`infra/`** - VPC, ECS cluster, ALB, shared resources
- **`portal/`** - Web UI, API routes, Terraform execution
- **`instance/`** - Per-interview infrastructure templates
- **`scenario/`** - Coding challenge files and environments

### Component Workflows

```bash
# Infrastructure changes
cd infra/ && terraform apply

# Portal deployment
cd portal/ && ./build-and-push.sh

# Template updates
cd instance/ && ./sync-to-s3.sh

# Scenario updates
cd scenario/ && ./sync-to-s3.sh
```

## Security & Cost

**Security:**

- Network isolation (private subnets)
- Password-protected instances
- Temporary access credentials
- No data persistence

**Cost Management:**

- Resources only exist during interviews
- Automatic cleanup on completion
- ~$0.50/hour per active interview
- ~$50/month base infrastructure

## Troubleshooting

**Common Issues:**

```bash
# AWS authentication
aws sso login --profile <AWS_PROFILE>
export AWS_PROFILE=<AWS_PROFILE>

# Test failures
npm install && npx playwright install
npm run test:quick

# Build issues
npm run format && npm run lint
```

**Getting Help:**

- Check `CONTRIBUTING.md` for development issues
- Review `portal/TESTING.md` for detailed testing guidance
- Check CloudWatch logs for production issues
- Review GitHub issues for known problems

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development environment setup
- Testing guidelines and commands
- Code quality standards
- Pull request process
- Troubleshooting guide

**Philosophy:** Local-first development with comprehensive testing before submission.