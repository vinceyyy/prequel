# SOCI Index Generator Module

**copied from https://github.com/awslabs/cfn-ecr-aws-soci-index-builder/tree/main**

This Terraform module creates all the necessary AWS resources for automatic SOCI (Seekable OCI) index generation when
container images are pushed to ECR.

## Features

- 🚀 **Automatic SOCI index generation** when images are pushed to ECR
- 📦 **Docker-based build process** for consistent Lambda builds
- 🔄 **Source change detection** automatically rebuilds Lambda when code changes
- 📊 **CloudWatch logging** for monitoring and debugging
- 🎯 **EventBridge integration** for ECR push event handling
- 🏗️ **IAM roles and policies** with least-privilege permissions

## Architecture

```
ECR Image Push → EventBridge → Lambda Function → SOCI Index → ECR
```

## Usage

```hcl
module "soci_index_generator" {
  source = "./modules/soci-index-generator"

  name_prefix         = "my-app"
  ecr_repository_name = aws_ecr_repository.my_repo.name
  ecr_repository_arn  = aws_ecr_repository.my_repo.arn
  lambda_source_path  = "${path.module}/lambda/soci-index-generator"

  tags = {
    Environment = "production"
    Project     = "my-project"
  }
}
```

## Requirements

- Docker installed on the machine running Terraform
- Go source code for the SOCI index generator Lambda
- AWS provider configured

## Inputs

| Name                | Description                           | Type          | Default | Required |
|---------------------|---------------------------------------|---------------|---------|:--------:|
| name_prefix         | Prefix for resource names             | `string`      | n/a     |   yes    |
| ecr_repository_name | Name of ECR repository to monitor     | `string`      | n/a     |   yes    |
| ecr_repository_arn  | ARN of ECR repository for permissions | `string`      | n/a     |   yes    |
| lambda_source_path  | Path to Lambda source code directory  | `string`      | n/a     |   yes    |
| lambda_timeout      | Lambda timeout in seconds             | `number`      | `900`   |    no    |
| lambda_memory_size  | Lambda memory size in MB              | `number`      | `2048`  |    no    |
| log_retention_days  | CloudWatch log retention days         | `number`      | `7`     |    no    |
| soci_index_version  | SOCI index version (V1 or V2)         | `string`      | `"V2"`  |    no    |
| tags                | Tags to apply to all resources        | `map(string)` | `{}`    |    no    |

## Outputs

| Name                      | Description                            |
|---------------------------|----------------------------------------|
| lambda_function_arn       | ARN of the SOCI index generator Lambda |
| lambda_function_name      | Name of the Lambda function            |
| iam_role_arn              | ARN of the Lambda IAM role             |
| cloudwatch_log_group_name | Name of the CloudWatch log group       |
| eventbridge_rule_arn      | ARN of the EventBridge rule            |
| build_info                | Information about the Lambda build     |

## Build Process

The module automatically:

1. **Detects source changes** by monitoring Go source files
2. **Builds the Lambda** using Docker when changes are detected
3. **Creates a zip file** with the compiled Go binary
4. **Updates the Lambda function** with the new code
5. **Cleans up** Docker images after build

## Manual Build

You can also build manually using the provided script:

```bash
cd lambda/soci-index-generator
./build-and-deploy.sh --deploy
```

## Monitoring

- **CloudWatch Logs**: `/aws/lambda/{name_prefix}-soci-index-generator`
- **Lambda Metrics**: Standard AWS Lambda metrics in CloudWatch
- **EventBridge Events**: Monitor ECR push events and Lambda invocations

## Troubleshooting

- Ensure Docker is running and accessible
- Check CloudWatch logs for Lambda execution errors
- Verify ECR repository permissions
- Confirm EventBridge rule is properly configured