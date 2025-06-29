#!/bin/bash

# Build and push Next.js portal to ECR

set -e

# Get ECR repository URL from Terraform output
ECR_REPO=$(cd ../infra && terraform output -raw ecr_repository_url)
AWS_REGION="your-aws-region"

echo "ECR Repository: $ECR_REPO"
echo "AWS Region: $AWS_REGION"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO

# Build the Docker image
echo "Building Docker image..."
docker build -t prequel-portal:latest .

# Tag the image for ECR
echo "Tagging image for ECR..."
docker tag prequel-portal:latest $ECR_REPO:latest

# Push to ECR
echo "Pushing image to ECR..."
docker push $ECR_REPO:latest

# Force ECS service deployment
echo "Triggering ECS service deployment..."
aws ecs update-service \
  --cluster prequel-dev \
  --service prequel-dev-portal \
  --force-new-deployment \
  --region $AWS_REGION > /dev/null

if [ $? -eq 0 ]; then
  echo "✅ ECS deployment triggered successfully!"
  echo "Monitoring deployment status..."
  
  # Wait for deployment to complete (with timeout)
  echo "Waiting for deployment to complete..."
  aws ecs wait services-stable \
    --cluster prequel-dev \
    --services prequel-dev-portal \
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
echo "Image: $ECR_REPO:latest"
echo "Service: prequel-dev-portal"