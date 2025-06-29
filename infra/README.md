# Prequel Terraform Infrastructure

This Terraform configuration provisions AWS infrastructure for the Prequel coding interview platform, which creates on-demand VS Code instances in the browser for candidates.

## Architecture

- **ECS Fargate**: Runs code-server containers
- **Application Load Balancer**: Routes traffic to code-server instances
- **VPC**: Isolated network with public/private subnets
- **Route 53**: Optional wildcard domain routing
- **SSM Parameter Store**: Secure password storage

## Prerequisites

1. **AWS CLI configured** with appropriate permissions
2. **Terraform installed** (>= 1.0)
3. **Optional**: ACM certificate for HTTPS
4. **Optional**: Route 53 hosted zone for custom domain

## Required AWS Permissions

Your AWS credentials need the following permissions:
- EC2 (VPC, subnets, security groups, NAT gateways)
- ECS (clusters, services, task definitions)
- ELB (Application Load Balancer, target groups)
- IAM (roles, policies)
- SSM (parameter store)
- CloudWatch (log groups)
- Route 53 (if using custom domain)
- ACM (if using HTTPS)

## Deployment

1. **Initialize Terraform**:
   ```bash
   terraform init
   ```

2. **Configure variables**:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your values
   ```

3. **Plan deployment**:
   ```bash
   terraform plan
   ```

4. **Deploy infrastructure**:
   ```bash
   terraform apply
   ```

## Configuration Options

### Basic Setup (HTTP only)
```hcl
aws_region = "your-aws-region"
environment = "dev"
```

### With Custom Domain and HTTPS
```hcl
aws_region = "your-aws-region"
environment = "prod"
domain_name = "your-domain.com"
# certificate_arn not needed - Terraform will create and validate automatically
```

## Outputs

After deployment, Terraform outputs key values needed for the admin panel:
- `ecs_cluster_name`: For creating ECS services
- `alb_dns_name`: Load balancer endpoint
- `code_server_security_group_id`: For ECS tasks
- `private_subnet_ids`: For ECS task placement

## Costs

Estimated monthly costs (your-aws-region):
- **Base infrastructure**: ~$50/month (ALB, NAT gateways)
- **Per active interview**: ~$0.50/hour (1 vCPU, 2GB RAM Fargate)

## Security

- Code-server instances run in private subnets
- Access only through Application Load Balancer
- Passwords stored in SSM Parameter Store (encrypted)
- Security groups restrict traffic to necessary ports

## Scaling

- Configure `max_instances` to limit concurrent interviews
- ECS Fargate automatically scales based on demand
- Each interview gets a dedicated container instance

## Cleanup

To destroy all resources:
```bash
terraform destroy
```

**Warning**: This will delete all infrastructure and data.