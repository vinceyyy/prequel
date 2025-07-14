#!/bin/bash

# Test SOCI Lambda with real code-server image
set -e

# Load environment variables from .env.local (check root directory)
if [ ! -f ../../.env.local ]; then
  echo "Error: .env.local file not found in project root"
  echo "Please copy .env.example to .env.local and configure your environment variables"
  exit 1
fi

export $(cat ../../.env.local | grep -v '^#' | sed 's/#.*//' | grep -v '^$' | xargs)

LAMBDA_NAME="${PROJECT_PREFIX}-${ENVIRONMENT}-soci-index-generator"
ECR_REPO="${PROJECT_PREFIX}-${ENVIRONMENT}-code-server"

echo "🎯 Testing SOCI Lambda with real code-server image..."

# Get the latest image from code-server repository
IMAGE_DIGEST=$(aws ecr list-images --repository-name "$ECR_REPO" --query 'imageIds[0].imageDigest' --output text)

if [ -z "$IMAGE_DIGEST" ] || [ "$IMAGE_DIGEST" = "None" ]; then
    echo "❌ No images found in $ECR_REPO repository"
    exit 1
fi

echo "📦 Using image digest: $IMAGE_DIGEST"

# Create test event with real image data
TEST_EVENT=$(cat <<EOF
{
  "version": "0",
  "id": "test-event-$(date +%s)",
  "detail-type": "ECR Image Action",
  "source": "aws.ecr",
  "account": "$(aws sts get-caller-identity --query Account --output text)",
  "time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "region": "$(aws configure get region)",
  "detail": {
    "action-type": "PUSH",
    "result": "SUCCESS",
    "repository-name": "$ECR_REPO",
    "image-tag": "latest",
    "image-digest": "$IMAGE_DIGEST",
    "image-uri": "$ECR_REPO@$IMAGE_DIGEST"
  }
}
EOF
)

echo "🚀 Invoking Lambda with real ECR event..."

# Invoke the Lambda function
aws lambda invoke \
    --function-name "$LAMBDA_NAME" \
    --payload "$TEST_EVENT" \
    --cli-binary-format raw-in-base64-out \
    response.json

echo "✅ Lambda invocation completed"
echo "Response:"
cat response.json | jq .

# Monitor logs
echo ""
echo "📊 Monitoring logs (will show for 30 seconds)..."
aws logs tail "/aws/lambda/$LAMBDA_NAME" --since 1m --follow &
LOG_PID=$!

sleep 30
kill $LOG_PID 2>/dev/null

# Clean up
rm -f response.json

echo ""
echo "✅ Test completed!"
echo "💡 If SOCI indexing succeeded, you should see a new image tag with '-soci' suffix in ECR"