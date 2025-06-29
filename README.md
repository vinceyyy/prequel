# Prequel

A tool for conducting better coding interviews by provisioning on-demand VS Code instances in the browser for candidates.

## Features

- **On-demand VS Code instances** - Each candidate gets a dedicated code-server container
- **Pre-configured scenarios** - JavaScript/React, Python/Data Science, SQL/Database, Full Stack
- **Automatic provisioning** - Infrastructure created and destroyed via Terraform
- **Secure access** - Password-protected instances with isolated environments
- **Real-time management** - Web-based admin panel for interview lifecycle
- **Cost-effective** - Resources only run during active interviews

## Architecture

- **Portal** - NextJS web interface for managing interviews
- **Infrastructure** - AWS ECS Fargate containers with Application Load Balancer
- **Scenarios** - EFS volumes with pre-configured files and challenges
- **Automation** - Terraform for infrastructure-as-code provisioning

## Quick Start

### Prerequisites

- AWS account with appropriate permissions
- Terraform installed (>= 1.0)
- Node.js installed (>= 18)
- AWS CLI configured with SSO profile `your-aws-profile`

### 1. Deploy Infrastructure

```bash
# Clone the repository
git clone <repository-url>
cd prequel

# Deploy base infrastructure
cd terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
```

**Configure your domain in `terraform.tfvars`:**
```hcl
domain_name = "your-domain.com"
```

**Deploy infrastructure:**
```bash
terraform apply
```

**Important:** Terraform will automatically:
- Create an ACM SSL certificate for your domain
- Set up DNS validation records in Route53
- Configure HTTPS redirect from HTTP
- Note the outputs - you'll need the EFS file system ID

### 2. Upload Scenarios to EFS

```bash
# Mount EFS locally (replace fs-xxxxx with your EFS ID from terraform output)
sudo mkdir /mnt/efs
sudo mount -t efs -o tls fs-xxxxx.efs.region.amazonaws.com:/ /mnt/efs

# Upload scenario files
sudo cp -r scenarios/* /mnt/efs/
sudo chown -R 1000:1000 /mnt/efs/
sudo chmod -R 755 /mnt/efs/
```

### 3. Start Portal

**Setup AWS SSO:**
```bash
# Configure AWS SSO profile
aws configure sso --profile your-aws-profile

# Login to AWS SSO
aws sso login --profile your-aws-profile
```

**Start the portal:**
```bash
cd portal
npm install
cp .env.example .env.local
# No additional configuration needed for .env.local in development
export AWS_PROFILE=your-aws-profile
npm run dev
```

Access the portal at `http://localhost:3000`

## Interview Flow

### 1. **Create Interview**
- Open portal
- Click "Create New Interview"
- Enter candidate name
- Select scenario type (JavaScript, Python, SQL, Full Stack)
- Click "Create Interview"

### 2. **Provision Infrastructure** (Automatic)
- Terraform creates isolated ECS service
- Mounts selected scenario files
- Configures load balancer routing
- Generates secure access credentials

### 3. **Share Access**
- Portal displays access URL and password
- Share credentials with candidate
- Candidate accesses VS Code in browser

### 4. **Conduct Interview**
- Candidate works in pre-configured environment
- All necessary tools and files available
- Real-time code editing and execution
- No local setup required

### 5. **Complete Interview**
- Portal admin clicks "Stop & Destroy"
- All AWS resources automatically cleaned up
- Interview data can be exported if needed

## Available Scenarios

### 📱 JavaScript/React
- React + TypeScript setup
- Todo list implementation challenge
- Modern development dependencies
- Component and state management tasks

### 🐍 Python/Data Science  
- Pandas, NumPy, Matplotlib environment
- Sample datasets for analysis
- Jupyter notebook support
- Data science and algorithm challenges

### 🗄️ SQL/Database
- Pre-configured SQLite database
- Sample data (customers, orders, products)
- Complex query challenges
- Database design and optimization

### 🔧 Full Stack
- React frontend + Node.js backend
- Authentication system skeleton
- Complete task management system to build
- End-to-end development challenge

## Management

### Monitoring Active Interviews
- View all running interviews in portal
- See candidate names, scenarios, and status
- Access URLs and passwords displayed
- Real-time status updates

### Cost Management
- Resources only exist during active interviews
- Automatic cleanup when interviews end
- Estimated cost: ~$0.50/hour per active interview
- Base infrastructure: ~$50/month (ALB + NAT gateways)

### Adding Custom Scenarios
1. Create new directory in `scenarios/`
2. Add all necessary files and documentation
3. Update `terraform/efs.tf` with new access point
4. Run `terraform apply`
5. Upload files to EFS mount

## Security

- **Network isolation** - Containers run in private subnets
- **Access control** - Password-protected instances
- **Encryption** - EFS and ECS data encrypted in transit and at rest
- **Temporary access** - Credentials unique per interview
- **No persistence** - All data destroyed after interview

## Troubleshooting

### Common Issues

**Interview creation fails (Local Development)**
- Run `aws sso login --profile your-aws-profile`
- Set `export AWS_PROFILE=your-aws-profile` 
- Verify Terraform infrastructure is deployed
- Check ECS cluster capacity limits

**Interview creation fails (Production)**
- Verify ECS task role has necessary permissions
- Check CloudWatch logs for detailed error messages
- Ensure base infrastructure is deployed

**"AWS SSO credentials not found" error**
- Run `aws sso login --profile your-aws-profile`
- Ensure AWS CLI is configured with SSO
- Restart the portal after login

**Scenario files not available**
- Ensure scenarios uploaded to EFS
- Check file permissions (1000:1000)
- Verify EFS mount targets in all subnets

**Access URL not working**
- Allow 2-3 minutes for container startup
- Check security group configurations
- Verify load balancer health checks

### Logs and Debugging
- ECS container logs in CloudWatch
- Terraform execution logs in portal
- Load balancer access logs (if enabled)

## Production Deployment

### ECS Deployment

The portal is designed to run on AWS ECS with the following setup:

1. **Create ECS Task Definition** for the portal with:
   - Task role with permissions for ECS, ELB, Route53, SSM, EFS
   - Environment variable: `NODE_ENV=production`
   - Docker image from your container registry

2. **Required IAM Permissions** for ECS task role:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ecs:*",
           "elasticloadbalancing:*",
           "route53:*",
           "ssm:GetParameter",
           "ssm:PutParameter",
           "elasticfilesystem:*"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

3. **Environment Variables** for production:
   - `NODE_ENV=production`
   - `AWS_REGION=your-aws-region`
   - No AWS_PROFILE needed (uses ECS task role)

### Local vs Production

| Environment | Authentication | Terraform Execution |
|-------------|----------------|---------------------|
| **Local** | AWS SSO (`your-aws-profile` profile) | Uses AWS_PROFILE |
| **Production** | ECS Task Role | Uses ECS metadata service |

## Contributing

1. Fork the repository
2. Create feature branch
3. Test with sample interviews
4. Submit pull request

## License

[License details]