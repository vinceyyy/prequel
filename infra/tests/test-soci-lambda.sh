#!/bin/bash

# Test SOCI Index Generator Lambda
# This script provides multiple ways to test the SOCI Lambda function

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get Lambda function name
LAMBDA_NAME=$(terraform output -json soci_index_generator | jq -r '.lambda_function_name')

if [ "$LAMBDA_NAME" = "null" ] || [ -z "$LAMBDA_NAME" ]; then
	echo -e "${RED}❌ Could not find SOCI Lambda function name from Terraform output${NC}"
	echo "Make sure the SOCI module is deployed: terraform apply"
	exit 1
fi

echo -e "${BLUE}🎯 Testing SOCI Index Generator Lambda: ${LAMBDA_NAME}${NC}"

# Function to create a test ECR event payload
create_test_event() {
	local repository_name="$1"
	local image_tag="${2:-latest}"

	cat <<EOF
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
    "repository-name": "$repository_name",
    "image-tag": "$image_tag",
    "image-digest": "sha256:$(openssl rand -hex 32)",
    "image-uri": "$repository_name:$image_tag"
  }
}
EOF
}

# Method 1: Direct Lambda invocation with test payload
test_with_mock_event() {
	echo -e "${YELLOW}📋 Method 1: Testing with mock ECR event${NC}"

	# Get code-server ECR repository name from Terraform
	ECR_REPO=$(terraform output -json | jq -r '.code_server_ecr_repository.value.repository_url' | cut -d'/' -f2)

	# Fallback to looking for code-server repository directly
	if [ "$ECR_REPO" = "null" ] || [ -z "$ECR_REPO" ]; then
		ECR_REPO=$(aws ecr describe-repositories --query 'repositories[?contains(repositoryName, `code-server`)].repositoryName' --output text | head -1)
	fi

	if [ "$ECR_REPO" = "null" ] || [ -z "$ECR_REPO" ]; then
		echo -e "${RED}❌ Could not find ECR repository name${NC}"
		return 1
	fi

	echo "Using ECR repository: $ECR_REPO"

	# Create test event payload
	TEST_EVENT=$(create_test_event "$ECR_REPO" "test-tag")

	echo -e "${BLUE}🚀 Invoking Lambda with test event...${NC}"

	# Invoke the Lambda function
	aws lambda invoke \
		--function-name "$LAMBDA_NAME" \
		--payload "$TEST_EVENT" \
		--cli-binary-format raw-in-base64-out \
		response.json

	echo -e "${GREEN}✅ Lambda invocation completed${NC}"
	echo "Response:"
	cat response.json | jq .

	# Clean up
	rm -f response.json
}

# Method 2: Test with a real ECR image (if available)
test_with_real_image() {
	echo -e "${YELLOW}📋 Method 2: Testing with real ECR image${NC}"

	# Get code-server ECR repository URL
	ECR_URL=$(terraform output -json | jq -r '.code_server_ecr_repository.value.repository_url // empty')

	# Fallback method
	if [ -z "$ECR_URL" ]; then
		ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
		REGION=$(aws configure get region)
		ECR_REPO_NAME=$(aws ecr describe-repositories --query 'repositories[?contains(repositoryName, `code-server`)].repositoryName' --output text | head -1)
		if [ -n "$ECR_REPO_NAME" ]; then
			ECR_URL="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO_NAME"
		fi
	fi

	if [ "$ECR_URL" = "null" ] || [ -z "$ECR_URL" ]; then
		echo -e "${RED}❌ Could not find ECR repository URL${NC}"
		return 1
	fi

	echo "ECR Repository: $ECR_URL"

	# Check if there are any images in the repository
	IMAGES=$(aws ecr list-images --repository-name "$(echo $ECR_URL | cut -d'/' -f2)" --query 'imageIds[0].imageTag' --output text 2>/dev/null || echo "None")

	if [ "$IMAGES" = "None" ] || [ "$IMAGES" = "null" ]; then
		echo -e "${YELLOW}⚠️  No images found in ECR repository${NC}"
		echo "Push an image first, then the Lambda will trigger automatically"
		return 0
	fi

	echo "Found image tag: $IMAGES"
	echo -e "${BLUE}💡 To trigger SOCI indexing for existing images, push a new tag:${NC}"
	echo "  docker tag $ECR_URL:$IMAGES $ECR_URL:soci-test"
	echo "  docker push $ECR_URL:soci-test"
}

# Method 3: Monitor Lambda logs
monitor_logs() {
	echo -e "${YELLOW}📋 Method 3: Monitoring Lambda logs${NC}"

	LOG_GROUP="/aws/lambda/$LAMBDA_NAME"

	echo -e "${BLUE}📊 Recent Lambda logs:${NC}"
	aws logs tail "$LOG_GROUP" --since 1h --follow &
	LOG_PID=$!

	echo -e "${YELLOW}⚠️  Monitoring logs (Ctrl+C to stop)...${NC}"
	echo "In another terminal, push an image to ECR or run this script with --invoke"

	# Wait for user interrupt
	trap "kill $LOG_PID 2>/dev/null; exit 0" INT
	wait $LOG_PID
}

# Method 4: Check Lambda configuration
check_config() {
	echo -e "${YELLOW}📋 Method 4: Checking Lambda configuration${NC}"

	echo -e "${BLUE}🔍 Lambda function details:${NC}"
	aws lambda get-function --function-name "$LAMBDA_NAME" | jq '{
        FunctionName: .Configuration.FunctionName,
        Runtime: .Configuration.Runtime,
        Handler: .Configuration.Handler,
        MemorySize: .Configuration.MemorySize,
        Timeout: .Configuration.Timeout,
        Environment: .Configuration.Environment,
        LastModified: .Configuration.LastModified
    }'

	echo -e "${BLUE}🎯 EventBridge rule status:${NC}"
	aws events list-rules --name-prefix "$(echo $LAMBDA_NAME | sed 's/-soci-index-generator//g')-ecr-image-push" | jq '.Rules[] | {Name: .Name, State: .State, EventPattern: .EventPattern}'
}

# Main script logic
case "${1:-help}" in
"--invoke" | "-i")
	test_with_mock_event
	;;
"--real" | "-r")
	test_with_real_image
	;;
"--logs" | "-l")
	monitor_logs
	;;
"--config" | "-c")
	check_config
	;;
"--all" | "-a")
	check_config
	echo ""
	test_with_mock_event
	echo ""
	test_with_real_image
	;;
*)
	echo -e "${BLUE}🧪 SOCI Lambda Test Script${NC}"
	echo ""
	echo "Usage: $0 [option]"
	echo ""
	echo "Options:"
	echo "  -i, --invoke    Invoke Lambda with mock ECR event"
	echo "  -r, --real      Test with real ECR image (shows instructions)"
	echo "  -l, --logs      Monitor Lambda logs in real-time"
	echo "  -c, --config    Check Lambda configuration and EventBridge setup"
	echo "  -a, --all       Run all tests (except log monitoring)"
	echo ""
	echo "Examples:"
	echo "  $0 --invoke     # Test Lambda directly"
	echo "  $0 --logs       # Monitor logs while pushing image"
	echo "  $0 --all        # Run all tests"
	;;
esac
