# Prequel Infrastructure

AWS infrastructure setup and management for the Prequel coding interview platform. This includes both shared
infrastructure (VPC, ECS, ALB) and per-interview Terraform templates stored in S3.

## Overview

The infrastructure uses a two-tier approach: shared infrastructure provisioned once, and per-interview resources created
dynamically. Shared infrastructure provides the foundation (VPC, ECS cluster, load balancer), while interview-specific
resources (ECS services, Route53 records) are created on-demand using Terraform templates stored in S3.

## Architecture

### Recent Architectural Improvements

**Shared ALB Architecture** - Interviews now share a single Application Load Balancer instead of creating dedicated ALBs. This reduces interview creation time from 4-6 minutes to ~1 minute by eliminating ALB provisioning overhead. Each interview gets a unique subdomain (interview-id.domain.com) with host-based routing rules.

**Secure Secret Management** - OpenAI admin keys are now stored in AWS Systems Manager Parameter Store as encrypted SecureString values instead of environment variables, improving security and enabling centralized secret management.

### Shared Infrastructure Components

**Core Services**

- **ECS Fargate** - Runs code-server containers for interview instances
- **Application Load Balancer** - Routes traffic to code-server instances with health checks
- **VPC** - Isolated network with public/private subnets for security
- **Route 53** - Optional wildcard domain routing for interview subdomains
- **SSM Parameter Store** - Secure password storage with encryption

**Storage & Processing**

- **S3 Buckets** - Terraform templates, challenge files, and candidate file history storage
- **ECR (Elastic Container Registry)** - Docker image repository for portal and code-server images
- **Lambda Functions** - SOCI container indexing for faster startup times
- **CloudWatch** - Logging and monitoring for all infrastructure components

**Security & Access**

- **IAM Roles** - Least-privilege permissions for ECS tasks and Lambda functions
- **Security Groups** - Network access control with minimal required ports
- **ACM Certificates** - Automatic HTTPS certificate provisioning and validation

### S3-Based Template System

The platform uses S3 to store and manage Terraform templates for interview instances. This architecture allows updating
infrastructure code without redeploying the NextJS application.

```
S3 Bucket: {project_prefix}-{environment}-instance
├── terraform/                      # Template files (source of truth)
│   ├── main.tf
│   ├── service.tf
│   ├── variables.tf
│   └── outputs.tf
└── workspaces/
    └── {interview-id}/              # Instance-specific workspaces
        ├── main.tf                  # Generated from templates
        ├── service.tf
        ├── variables.tf
        ├── outputs.tf
        └── terraform.tfvars        # Runtime configuration

S3 Bucket: {project_prefix}-{environment}-challenge
├── python/                         # Python challenge files
├── javascript/                     # JavaScript challenge files  
└── sql/                           # SQL challenge files

S3 Bucket: {project_prefix}-{environment}-history
└── {interview-id}/                 # Candidate saved files (tar.gz format)
    └── files.tar.gz
```

## Prerequisites

- AWS account with appropriate permissions (see Required Permissions below)
- Terraform installed (>= 1.0)
- AWS CLI configured with SSO or credentials
- Domain name configured in Route53 hosted zone (for custom domains)

## Required AWS Permissions

Your AWS credentials need permissions for:

**Core Infrastructure:**

- EC2 (VPC, subnets, security groups, NAT gateways)
- ECS (clusters, services, task definitions)
- ELB (Application Load Balancer, target groups)
- IAM (roles, policies, instance profiles)

**Storage & DNS:**

- S3 (buckets, objects, versioning)
- Route 53 (hosted zones, records)
- ACM (certificates, validation)
- SSM (parameter store access)

**Monitoring & Processing:**

- CloudWatch (log groups, metrics)
- Lambda (functions, triggers)

## Deployment

### 1. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your domain and settings

cp backend.config.example backend.config
# Edit backend.config with your S3 backend configuration
```

**⚠️ Critical: Environment Consistency**

The portal uses a **centralized configuration system** that auto-generates AWS resource names. Your infrastructure values must match your portal configuration:

```hcl
# infra/terraform.tfvars
project_prefix = "your-prefix"    # Must match PROJECT_PREFIX in .env.local
environment    = "dev"            # Must match ENVIRONMENT in .env.local
aws_region     = "us-east-1"      # Must match AWS_REGION in .env.local
domain_name    = "your-domain.com"
```

```bash
# .env.local (portal configuration)
PROJECT_PREFIX=your-prefix        # Must match project_prefix above
ENVIRONMENT=dev                   # Must match environment above
AWS_REGION=us-east-1             # Must match aws_region above
```

**Optional Customization:**

```hcl
vpc_cidr      = "10.0.0.0/16"
max_instances = 10
```

**Auto-Generated Resource Names:**

All AWS resources use consistent naming with environment suffixes:
- **DynamoDB Tables**: `{project_prefix}-{environment}-interviews`, `{project_prefix}-{environment}-operations`
- **S3 Buckets**: `{project_prefix}-{environment}-challenge`, `{project_prefix}-{environment}-instance`, `{project_prefix}-{environment}-history`
- **ECS Cluster**: `{project_prefix}-{environment}`

### 2. Deploy Infrastructure

```bash
terraform init -backend-config=backend.config
terraform plan
terraform apply  # Includes automated portal Docker image building and pushing
```

**ECS Portal Bootstrapping:**

The deployment process now includes automated portal Docker image building and pushing:

- **Automated Image Building** - `bootstrap-portal-image.sh` script builds and pushes portal Docker image to ECR during Terraform deployment
- **Cross-platform Support** - Uses Docker Buildx for AMD64 architecture (ECS compatibility)
- **Dependency Management** - ECS service waits for image build completion via `null_resource` dependency
- **Environment Integration** - All necessary environment variables passed from Terraform to build script

**Build Triggers:**

The portal image is rebuilt automatically when:
- Portal `Dockerfile` changes
- Portal `package.json` changes  
- ECR repository configuration changes
- Any Terraform infrastructure changes

**Manual Image Rebuild:**

```bash
cd infra
terraform apply -replace=null_resource.portal_image_build
```

## Infrastructure Outputs

After deployment, Terraform provides key values for the portal application:

- `ecs_cluster_name` - For creating ECS services
- `alb_dns_name` - Load balancer endpoint
- `portal_url` - Portal access URL
- `alb_security_group_id` - For ECS interview tasks (shared ALB)
- `private_subnet_ids` - For ECS task placement

## Cost Optimization

**Estimated Monthly Costs (your-aws-region):**

- Base infrastructure: ~$50/month (ALB, NAT gateways, S3)
- Per active interview: ~$0.50/hour (1 vCPU, 2GB RAM Fargate)
- Storage: ~$5/month (S3, CloudWatch logs)

**Cost-Saving Features:**

- Fargate pricing only during active interviews
- Automatic resource cleanup after timeouts
- SOCI indexing for faster container startup (reduced runtime costs)
- Shared infrastructure serves unlimited interviews

## Security Features

**Network Isolation:**

- Code-server instances run in private subnets
- Access only through Application Load Balancer
- Security groups restrict traffic to necessary ports

**Access Control:**

- Passwords stored in SSM Parameter Store with encryption
- IAM roles with least-privilege permissions
- HTTPS-only access with automatic certificate management

**Data Protection:**

- No persistent data storage in interview containers
- Automatic cleanup prevents data leakage
- Network segmentation isolates interview environments

## Scaling Configuration

- Configure `max_instances` to limit concurrent interviews
- ECS Fargate automatically scales based on demand
- Each interview gets a dedicated container instance
- ALB handles load distribution and health checks

## Troubleshooting

### Common Infrastructure Issues

**Template Download Fails:**
Check S3 bucket permissions and ensure `{project_prefix}-{environment}-instance` bucket exists. Verify AWS credentials have S3 read access.

**Interview Creation Fails After Template Update:**
Check CloudWatch logs for Terraform errors. Verify template syntax is valid and test templates locally before uploading.

**Certificate Validation Issues:**
Ensure domain is properly configured in Route53. ACM certificate validation requires DNS records in the hosted zone.

## Monitoring

- CloudWatch logs capture all ECS and Lambda activity
- ALB access logs provide request-level monitoring
- S3 access logs track template downloads and uploads
- ECS service metrics monitor container health and performance

For production deployments, consider setting up CloudWatch alarms for key metrics like ECS service health, ALB response
times, and S3 bucket access patterns.