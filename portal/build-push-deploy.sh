#!/bin/bash

# Build and push Next.js portal to ECR
#
# Usage: ./build-push-deploy.sh [environment]
#   environment: dev, prod, or staging (optional, defaults to ENVIRONMENT from .env.local)

set -e

# Load environment variables from .env.local (check root directory)
if [ ! -f ../.env.local ]; then
	echo "Error: .env.local file not found in project root"
	echo "Please copy .env.example to .env.local and configure your environment variables"
	exit 1
fi

export $(cat ../.env.local | grep -v '^#' | sed 's/#.*//' | grep -v '^$' | xargs)

# Allow environment override from command line
TARGET_ENV=${1:-$ENVIRONMENT}

# Make sure it passes linter
echo "Linter check..."
npm run format
npm run lint
echo "Linter passed. Start building..."

# Configuration - use environment variables
AWS_REGION=${AWS_REGION:-"your-aws-region"}
PROJECT_PREFIX=${PROJECT_PREFIX:-"prequel"}

echo "Building for environment: $TARGET_ENV"

# Get ECR repository URL from Terraform output
ECR_URI=$(cd ../infra/environments/${TARGET_ENV} && terraform output -raw ecr_repository_url)

echo "ECR Repository: $ECR_URI"
echo "AWS Region: $AWS_REGION"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Build the Docker image for AMD64 (ECS compatibility)
echo "Building Docker image for AMD64..."
docker buildx create --use --name multiarch-builder --driver docker-container 2>/dev/null || true
docker buildx build --platform=linux/amd64 -t "$ECR_URI:latest" --push .

# Force ECS service deployment
echo "Triggering ECS service deployment..."
aws ecs update-service \
	--cluster ${PROJECT_PREFIX}-${TARGET_ENV} \
	--service ${PROJECT_PREFIX}-${TARGET_ENV}-portal \
	--force-new-deployment \
	--region $AWS_REGION >/dev/null

if [ $? -eq 0 ]; then
	echo "✅ ECS deployment triggered successfully!"
	echo "Monitoring deployment status..."

	# Wait for deployment to complete (with timeout)
	echo "Waiting for deployment to complete..."
	aws ecs wait services-stable \
		--cluster ${PROJECT_PREFIX}-${TARGET_ENV} \
		--services ${PROJECT_PREFIX}-${TARGET_ENV}-portal \
		--region $AWS_REGION \
		--cli-read-timeout 600 \
		--cli-connect-timeout 60

	if [ $? -eq 0 ]; then
		echo "✅ Deployment completed successfully!"
	else
		echo "⚠️  Deployment is taking longer than expected. Check AWS console for status."
	fi
else
	echo "❌ Failed to trigger ECS deployment"
	exit 1
fi

echo ""
echo "🚀 Build, push, and deployment completed!"
echo "Image: $ECR_URI:latest"
echo "Service: ${PROJECT_PREFIX}-${TARGET_ENV}-portal"
