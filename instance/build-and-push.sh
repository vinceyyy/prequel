#!/bin/bash

set -e

# Configuration
REPOSITORY_NAME="prequel-dev-code-server"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile "$AWS_PROFILE" --region "$AWS_REGION")
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPOSITORY_NAME}"
AWS_REGION="your-aws-region"

echo "Building code-server Docker image..."
echo "Repository: $ECR_URI"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Build and push the Docker image for AMD64 (ECS Fargate architecture)
echo "Building and pushing Docker image..."
docker buildx build --platform=linux/amd64 -t "$ECR_URI:latest" --push .

echo "✅ Code-server image built and pushed successfully!"
echo "Image URI: $ECR_URI:latest"