# Prequel Project Structure

This document outlines the organized project structure for the Prequel coding interview platform.

## Directory Layout

```
prequel/
├── infra/                          # Common infrastructure Terraform code
│   ├── main.tf                     # Main infrastructure configuration
│   ├── alb.tf                      # Application Load Balancer
│   ├── ecs.tf                      # ECS cluster and services
│   ├── ecr.tf                      # Container registry
│   ├── networking.tf               # VPC, subnets, security groups
│   ├── s3.tf                       # S3 buckets for state and instance code
│   └── ...                         # Other infrastructure components
├── portal/                         # NextJS web application
│   ├── src/                        # Application source code
│   ├── Dockerfile                  # Container definition
│   ├── build-and-push.sh          # Build and deployment script
│   └── package.json                # Dependencies
├── instance/                       # Interview instance Terraform templates
│   ├── main.tf                     # Instance infrastructure
│   ├── service.tf                  # ECS services, EFS, load balancer rules
│   ├── variables.tf                # Input variables
│   ├── outputs.tf                  # Output values
│   └── sync-to-s3.sh              # Upload script for instance templates
├── scenario/                       # Interview scenario files
│   ├── python/                     # Python coding challenges
│   ├── javascript/                 # JavaScript/React challenges
│   ├── sql/                        # SQL query challenges
│   ├── fullstack/                  # Full-stack challenges
│   └── sync-to-s3.sh              # Upload script for scenarios
├── sync-to-s3.sh                  # Master sync script (both instance & scenarios)
└── README.md                       # Project documentation
```

## Key Benefits of This Structure

1. **Separation of Concerns**: Infrastructure, application, instance templates, and scenarios are clearly separated
2. **Independent Updates**: Each component can be updated independently without affecting others
3. **Scalability**: Easy to add new scenario types or infrastructure components
4. **Maintainability**: Clear organization makes the codebase easier to navigate and maintain

## Working with the Structure

### Infrastructure Changes
```bash
cd infra/
# Make changes to infrastructure
terraform plan
terraform apply
```

### Portal Updates
```bash
cd portal/
# Make changes to NextJS app
./build-and-push.sh  # Build and deploy
```

### Instance Template Updates
```bash
cd instance/
# Make changes to interview instance templates
./sync-to-s3.sh      # Upload to S3
```

### Scenario Updates
```bash
cd scenario/
# Add/modify scenario files
./sync-to-s3.sh      # Upload to S3
```

### Bulk Updates
```bash
# From project root
./sync-to-s3.sh                    # Sync both instance and scenarios
./sync-to-s3.sh --instance         # Sync only instance templates
./sync-to-s3.sh --scenario         # Sync only scenarios
./sync-to-s3.sh --dry-run          # Preview changes
```

## S3 Storage Structure

The instance templates and scenarios are stored in S3 for hot-swapping without app redeployment:

```
s3://prequel-instance/
├── instance/                       # Template files (source of truth)
│   ├── main.tf
│   ├── service.tf
│   ├── variables.tf
│   └── outputs.tf
├── scenario/                       # Scenario files
│   ├── python/
│   ├── javascript/
│   └── sql/
└── workspaces/                     # Per-interview workspaces
    └── {interview-id}/
        ├── main.tf                 # Generated from templates
        ├── service.tf
        ├── variables.tf
        ├── outputs.tf
        └── terraform.tfvars       # Runtime configuration
```

## Migration Notes

This structure was migrated from the previous layout where:
- Infrastructure was in `/terraform/`
- Instance templates were in `/portal/src/terraform/interview-instance/`
- Scenarios were in `/scenarios/` and `/portal/src/scenarios/`

All path references have been updated accordingly in:
- `portal/src/lib/terraform.ts` - Updated to download from new S3 paths
- `portal/build-and-push.sh` - Updated to reference `../infra/` for ECR URL
- Sync scripts - Created new individual and master sync scripts

## Development Workflow

1. **Infrastructure changes**: Work in `infra/`, apply with Terraform
2. **Application changes**: Work in `portal/`, deploy with build script
3. **Template changes**: Work in `instance/`, sync to S3
4. **Scenario changes**: Work in `scenario/`, sync to S3
5. **Testing**: Use `--dry-run` flags to preview S3 sync operations