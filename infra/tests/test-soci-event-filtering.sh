#!/bin/bash

# Test SOCI Event Filtering Lambda
# This script tests the new event filtering architecture

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get Lambda function names from Terraform
EVENT_FILTER_LAMBDA=$(terraform output -json soci_index_generator | jq -r '.event_filter_function_name')
SOCI_LAMBDA=$(terraform output -json soci_index_generator | jq -r '.soci_lambda_function_name')
ECR_REPO=$(terraform output -json | jq -r '.code_server_ecr_repository.value.name // "prequel-dev-code-server"')

if [ "$EVENT_FILTER_LAMBDA" = "null" ] || [ -z "$EVENT_FILTER_LAMBDA" ]; then
	echo -e "${RED}❌ Could not find event filtering Lambda function name from Terraform output${NC}"
	exit 1
fi

echo -e "${BLUE}🎯 Testing SOCI Event Filtering Architecture${NC}"
echo "Event Filter Lambda: $EVENT_FILTER_LAMBDA"
echo "SOCI Generator Lambda: $SOCI_LAMBDA"
echo "ECR Repository: $ECR_REPO"
echo ""

# Function to create test ECR event
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

# Test 1: Normal image (should be processed)
test_normal_image() {
	echo -e "${YELLOW}📋 Test 1: Normal image (should trigger SOCI indexing)${NC}"

	TEST_EVENT=$(create_test_event "$ECR_REPO" "latest")

	echo -e "${BLUE}🚀 Invoking event filtering Lambda...${NC}"
	aws lambda invoke \
		--function-name "$EVENT_FILTER_LAMBDA" \
		--payload "$TEST_EVENT" \
		--cli-binary-format raw-in-base64-out \
		response1.json

	echo "Response:"
	cat response1.json | jq .
	echo ""
}

# Test 2: SOCI image (should be skipped)
test_soci_image() {
	echo -e "${YELLOW}📋 Test 2: SOCI image (should be skipped to prevent infinite loop)${NC}"

	TEST_EVENT=$(create_test_event "$ECR_REPO" "latest-soci")

	echo -e "${BLUE}🚀 Invoking event filtering Lambda...${NC}"
	aws lambda invoke \
		--function-name "$EVENT_FILTER_LAMBDA" \
		--payload "$TEST_EVENT" \
		--cli-binary-format raw-in-base64-out \
		response2.json

	echo "Response:"
	cat response2.json | jq .
	echo ""
}

# Test 3: Different repository (should be skipped)
test_different_repo() {
	echo -e "${YELLOW}📋 Test 3: Different repository (should be skipped due to filter)${NC}"

	TEST_EVENT=$(create_test_event "different-repo" "latest")

	echo -e "${BLUE}🚀 Invoking event filtering Lambda...${NC}"
	aws lambda invoke \
		--function-name "$EVENT_FILTER_LAMBDA" \
		--payload "$TEST_EVENT" \
		--cli-binary-format raw-in-base64-out \
		response3.json

	echo "Response:"
	cat response3.json | jq .
	echo ""
}

# Monitor logs function
monitor_logs() {
	echo -e "${YELLOW}📋 Monitoring Lambda logs${NC}"

	EVENT_FILTER_LOG_GROUP="/aws/lambda/$EVENT_FILTER_LAMBDA"
	SOCI_LOG_GROUP="/aws/lambda/$SOCI_LAMBDA"

	echo -e "${BLUE}📊 Recent event filtering logs:${NC}"
	aws logs tail "$EVENT_FILTER_LOG_GROUP" --since 5m || echo "No recent logs"

	echo -e "${BLUE}📊 Recent SOCI generator logs:${NC}"
	aws logs tail "$SOCI_LOG_GROUP" --since 5m || echo "No recent logs"
}

# Main execution
case "${1:-all}" in
"normal")
	test_normal_image
	;;
"soci")
	test_soci_image
	;;
"different")
	test_different_repo
	;;
"logs")
	monitor_logs
	;;
"all")
	test_normal_image
	sleep 2
	test_soci_image
	sleep 2
	test_different_repo
	echo ""
	monitor_logs
	;;
*)
	echo -e "${BLUE}🧪 SOCI Event Filtering Test Script${NC}"
	echo ""
	echo "Usage: $0 [test]"
	echo ""
	echo "Tests:"
	echo "  normal      Test normal image (should trigger SOCI)"
	echo "  soci        Test SOCI image (should be skipped)"
	echo "  different   Test different repo (should be filtered)"
	echo "  logs        Show recent Lambda logs"
	echo "  all         Run all tests (default)"
	;;
esac

# Clean up
rm -f response*.json

echo -e "${GREEN}✅ Test completed!${NC}"
