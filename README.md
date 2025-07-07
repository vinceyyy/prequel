# Prequel

A real-time coding interview platform that provisions on-demand VS Code instances in the browser for candidates.

## What is Prequel?

Prequel enables companies to conduct coding interviews using isolated, pre-configured VS Code environments that
candidates access directly in their browser. Each interview gets its own containerized environment with the necessary
tools and challenges.

The platform provides zero setup for candidates who need only a browser, ensuring consistent environments with the same
tools and versions for all candidates. Real-time management capabilities offer live status updates and scheduling
features, while cost-effective resource usage means infrastructure only runs during interviews at approximately $0.50
per hour. Security and isolation are maintained through separate containers for each interview with automatic cleanup.

## User Flow

1. **Login to portal** (authentication not yet implemented)
2. **Create an interview**
    - Select a challenge from S3. The challenge files will be available when the candidate opens the editor.
    - Optionally, the interview can be scheduled for a future time
    - **Mandatory**: set a duration (30min-4hrs) - interviews are automatically destroyed when time expires
3. **Wait for provisioning** - AWS infrastructure is created automatically via Terraform
    - Status changes from "Scheduled" → "Initializing" → "Configuring" → "Active"
4. **Share access details** - Copy the URL and password from the portal and send to the candidate
5. **Conduct the interview** - Candidate accesses the full VS Code environment in their browser
6. **Automatic cleanup** - Resources are destroyed automatically when the duration expires or manually destroyed

## Project Structure

```
prequel/
├── infra/           # Shared AWS infrastructure (VPC, ECS, ALB)
├── portal/          # NextJS web interface
├── instance/        # Interview runtime image and deployment template  
└── challenge/       # Interview coding challenges
```

## Quick Start

### Prerequisites

- AWS account with ECS, ALB, and Route53 permissions
- Domain name configured in Route53 hosted zone
- Local tools: Node.js 18+, AWS CLI, Terraform 1.0+

### Deployment Steps

1. **Configure AWS authentication**
   ```bash
   aws configure sso --profile <your-profile>
   aws sso login --profile <your-profile>
   export AWS_PROFILE=<your-profile>
   ```

2. **Deploy infrastructure**
   ```bash
   cd infra/
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your configuration
   terraform init
   terraform apply
   ```

3. **Deploy portal**
   ```bash
   cd portal/
   ./build-push-deploy.sh
   ```

4. **Deploy instance runtime**
   ```bash
   cd instance/
   ./build-and-push.sh
   ```

5. **Sync challenges**
   ```bash
   cd challenge/
   ./sync-to-s3.sh
   ```

Your Prequel platform will now be available at your configured domain.

## AWS Resources Required

The platform requires several AWS services for proper operation:

**Core Infrastructure:**

- ECS cluster for running interview containers
- Application Load Balancer for traffic routing with health checks
- VPC with public/private subnets for network isolation
- Route53 for DNS management and subdomain routing
- ECR repository for container image storage

**Storage & Processing:**

- S3 buckets for challenge files, Terraform state, and container templates
- Lambda functions for SOCI container indexing (faster startup times)
- CloudWatch for logging and monitoring

**Security:**

- IAM roles with least-privilege permissions for ECS tasks
- Security groups for network access control
- TLS certificates for HTTPS encryption via ACM

## How It Works

### Component Integration

The platform orchestrates four main components to deliver seamless coding interviews. The **portal** (NextJS
application) serves as your control center with Server-Sent Events providing real-time status updates. When you create
an interview, the portal downloads Terraform templates from S3 and provisions dedicated AWS resources.

The **infrastructure** component uses a two-tier approach: shared AWS infrastructure (VPC, ECS cluster, ALB) remains
always provisioned, while interview-specific resources (ECS services, Route53 records) are created on-demand using
Terraform. This hybrid approach keeps base costs around $50/month while adding only $0.50/hour per active interview.

**Interview instances** run as isolated ECS Fargate containers with pre-configured VS Code environments. Each candidate
gets a dedicated container with 1 vCPU and 2GB RAM, completely isolated from other interviews. SOCI indexing via Lambda
functions ensures faster container startup. Containers are automatically destroyed after the configured duration (
30min-4hrs).

**Challenges** are stored in S3 and automatically synchronized to each interview environment during the "configuring"
phase. The system supports JavaScript (Node.js + React), Python (Pandas + Jupyter), and SQL (SQLite) environments.
Challenge files become available in the candidate's VS Code workspace once the status reaches "active".

### Technical Workflow

**For New Interviews:**

1. Portal downloads Terraform templates from `s3://prequel-instance/instance/`
2. Replaces `INTERVIEW_ID_PLACEHOLDER` with actual interview ID
3. Creates interview-specific `terraform.tfvars` configuration
4. Uploads complete workspace to `s3://prequel-instance/workspaces/{interview-id}/`
5. Terraform provisions ECS service, Route53 subdomain, and security groups
6. Container starts, challenge files sync from S3, VS Code becomes accessible

**For Scheduled Interviews:**
The background scheduler (30-second polling) processes scheduled operations and auto-destroy timeouts. All status
changes trigger immediate SSE events to update the portal UI in real-time without page refresh.

## Contributing

We welcome contributions to the project. The CONTRIBUTING.md file provides comprehensive guidance covering development
environment setup, testing strategies and commands, code quality standards and architecture guidelines, pull request
process and review guidelines, and troubleshooting for common development issues.

Our development philosophy emphasizes local-first testing with comprehensive validation before code submission.

## Troubleshooting

### Common Issues

For AWS authentication problems, run `aws sso login --profile <your-profile>` and `export AWS_PROFILE=<your-profile>`.
Development server issues can typically be resolved by navigating to the portal directory, running `npm install`, and
starting the development server with `npm run dev`. Build and test failures often require running `npm run format` to
fix code formatting, `npm run lint` to check code quality, and `npm run test:quick` to run the validation suite.

### Getting Help

Several resources are available for assistance. Development issues should be addressed by consulting CONTRIBUTING.md.
Component-specific questions can be answered through the respective component README files. Production issues can be
diagnosed through CloudWatch logs, while known issues are tracked in GitHub Issues.

## License

This project is licensed under the MIT License - see the LICENSE.txt file for details.