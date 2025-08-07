#!/bin/bash

# Bootstrap script to build and push portal Docker image during Terraform apply
# This ensures the portal image exists in ECR before ECS service creation

set -e

echo "🚀 Bootstrapping portal Docker image for Terraform deployment..."

# Load environment variables from project root .env.local
if [ ! -f ../.env.local ]; then
	echo "Warning: .env.local file not found in project root"
	echo "Using environment variables passed by Terraform"
fi

# Try to load from .env.local if it exists, otherwise rely on Terraform environment variables
if [ -f ../.env.local ]; then
	export $(cat ../.env.local | grep -v '^#' | sed 's/#.*//' | grep -v '^$' | xargs)
fi

# Configuration - prioritize environment variables passed by Terraform
AWS_REGION=${AWS_REGION:-"us-east-1"}
PROJECT_PREFIX=${PROJECT_PREFIX:-"prequel"}
ENVIRONMENT=${ENVIRONMENT:-"dev"}

echo "Configuration:"
echo "  AWS Region: $AWS_REGION"
echo "  Project Prefix: $PROJECT_PREFIX" 
echo "  Environment: $ENVIRONMENT"

# Get ECR repository URL from environment variable (passed by Terraform)
echo "Getting ECR repository URL from Terraform environment..."
ECR_URI=${ECR_REPOSITORY_URL}

if [ -z "$ECR_URI" ]; then
	echo "❌ Error: ECR_REPOSITORY_URL environment variable not set by Terraform"
	exit 1
fi

echo "ECR Repository: $ECR_URI"

# Navigate to portal directory
cd ../portal

# Run linter checks (skip if not in CI environment)
if command -v npm >/dev/null 2>&1; then
	echo "Running code quality checks..."
	npm run format
	npm run lint
	echo "✅ Code quality checks passed"
else
	echo "⚠️  npm not found, skipping linter checks"
fi

# Login to ECR
echo "Logging in to ECR..."
ECR_REGISTRY=$(echo $ECR_URI | cut -d'/' -f1)
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY

# Build and push the Docker image for AMD64 (ECS compatibility)
echo "Building and pushing Docker image for AMD64..."
docker buildx create --use --name terraform-builder --driver docker-container 2>/dev/null || true
docker buildx build --platform=linux/amd64 -t "$ECR_URI:latest" --push .

echo ""
echo "✅ Portal Docker image bootstrap completed!"
echo "Image: $ECR_URI:latest"
echo "Terraform can now proceed with ECS service creation."