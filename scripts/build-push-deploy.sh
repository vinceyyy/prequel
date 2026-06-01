#!/bin/bash

# Build and push the Prequel app image (Hono backend + Vite SPA) to ECR, then
# force a new ECS deployment.
#
# Usage: ./scripts/build-push-deploy.sh [environment]
#   environment: dev, prod, or staging (defaults to ENVIRONMENT from .env.local)
#
# Run from the repo root. The Docker build context is the repo root and the
# Dockerfile lives at backend/Dockerfile (it builds both workspace packages).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ]; then
	echo "Error: .env.local not found in project root"
	exit 1
fi
export $(grep -v '^#' .env.local | sed 's/#.*//' | grep -v '^$' | xargs)

TARGET_ENV=${1:-${ENVIRONMENT:-dev}}
AWS_REGION=${AWS_REGION:-us-east-1}

echo "==> Quality gate (oxfmt + oxlint + tsc)"
pnpm run check

echo "==> Building for environment: $TARGET_ENV"
ECR_URI=$(cd "infra/environments/${TARGET_ENV}" && terraform output -raw ecr_repository_url)
echo "    ECR: $ECR_URI  Region: $AWS_REGION"

aws ecr get-login-password --region "$AWS_REGION" ${AWS_PROFILE:+--profile "$AWS_PROFILE"} \
	| docker login --username AWS --password-stdin "$ECR_URI"

# Build for amd64 (Fargate). Context = repo root; Dockerfile = backend/Dockerfile.
docker build --platform linux/amd64 -f backend/Dockerfile -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:latest"

echo "==> Forcing new ECS deployment"
CLUSTER="${PROJECT_PREFIX:-prequel}-${TARGET_ENV}"
aws ecs update-service \
	--cluster "$CLUSTER" \
	--service "${PROJECT_PREFIX:-prequel}-${TARGET_ENV}-portal" \
	--force-new-deployment \
	--region "$AWS_REGION" ${AWS_PROFILE:+--profile "$AWS_PROFILE"} >/dev/null

echo "==> Done. Watch rollout in the ECS console or with: aws ecs describe-services ..."
