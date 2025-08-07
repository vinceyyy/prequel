#!/bin/bash

# Sync challenge files to S3 bucket
# Usage: ./sync-to-s3.sh
#
# This script should be run from the challenge/ directory and will upload
# all subdirectories as challenges to S3, excluding this script itself.
#
# Use environment variables for AWS configuration:
# - AWS_PROFILE: AWS profile to use (optional)
# - AWS_REGION: AWS region (default: us-east-1n)
# - PROJECT_PREFIX: Project prefix for bucket naming (default: prequel)
# - ENVIRONMENT: Environment for bucket naming (default: dev)

set -e

# Load environment variables from .env.local (check root directory)
if [ ! -f ../.env.local ]; then
	echo "Error: .env.local file not found in project root"
	echo "Please copy .env.example to .env.local and configure your environment variables"
	exit 1
fi

export $(cat ../.env.local | grep -v '^#' | sed 's/#.*//' | grep -v '^$' | xargs)

BUCKET_NAME="${PROJECT_PREFIX}-${ENVIRONMENT:-dev}-challenge"
REGION=${AWS_REGION:-"us-east-1"}

echo "Syncing challenges to S3 bucket: ${BUCKET_NAME}"
echo "AWS Profile: ${AWS_PROFILE:-default}"
echo "Region: ${REGION}"

# Get the directory where this script is located (should be challenge/)
SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR"

# Upload each challenge directory to S3
for challenge_dir in */; do
	# Skip if it's not a directory
	if [ ! -d "$challenge_dir" ]; then
		continue
	fi

	challenge_name=$(basename "$challenge_dir")
	echo "Uploading challenge: $challenge_name"

	aws s3 sync "$challenge_dir" "s3://${BUCKET_NAME}/${challenge_name}/" \
		--region "$REGION" \
		--delete \
		--exclude ".*" \
		--exclude "__pycache__/*" \
		--exclude "node_modules/*" \
		--exclude "sync-to-s3.sh"

	echo "✅ Uploaded $challenge_name"
done

echo ""
echo "🎉 All challenges uploaded successfully!"
echo ""
echo "Available challenges in S3:"
aws s3 ls "s3://${BUCKET_NAME}/" --region "$REGION"
