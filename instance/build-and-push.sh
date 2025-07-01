#!/bin/bash

set -e

# Configuration
AWS_PROFILE=${AWS_PROFILE:-your-aws-profile}
AWS_REGION=${AWS_REGION:-your-aws-region}
REPOSITORY_NAME="prequel-dev-code-server"

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile "$AWS_PROFILE" --region "$AWS_REGION")
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPOSITORY_NAME}"

echo "Building code-server Docker image..."
echo "Repository: $ECR_URI"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" --profile "$AWS_PROFILE" | docker login --username AWS --password-stdin "$ECR_URI"

# Build the Docker image for AMD64 (ECS Fargate architecture) from parent directory
echo "Building Docker image..."
cd ..  # Move to parent directory to include scenario/ in build context
docker buildx build --platform linux/amd64 -f instance/Dockerfile -t "$ECR_URI:latest" .

# Push to ECR
echo "Pushing image to ECR..."
docker push "$ECR_URI:latest"

echo "✅ Code-server image built and pushed successfully!"
echo "Image URI: $ECR_URI:latest"