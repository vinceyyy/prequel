#!/bin/bash

# Sync scenario files to S3 bucket
# Usage: ./sync-scenarios-to-s3.sh
# 
# This script should be run from the scenario/ directory and will upload
# all subdirectories as scenarios to S3, excluding this script itself.
# 
# Use environment variables for AWS configuration:
# - AWS_PROFILE: AWS profile to use (optional)
# - AWS_REGION: AWS region (default: your-aws-region)

set -e

BUCKET_NAME="prequel-scenario"
REGION=${AWS_REGION:-your-aws-region}

echo "Syncing scenarios to S3 bucket: ${BUCKET_NAME}"
echo "AWS Profile: ${AWS_PROFILE:-default}"
echo "Region: ${REGION}"

# Get the directory where this script is located (should be scenario/)
SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR"

# Upload each scenario directory to S3
for scenario_dir in */; do
    # Skip if it's not a directory
    if [ ! -d "$scenario_dir" ]; then
        continue
    fi
    
    scenario_name=$(basename "$scenario_dir")
    echo "Uploading scenario: $scenario_name"
    
    aws s3 sync "$scenario_dir" "s3://${BUCKET_NAME}/${scenario_name}/" \
        --region "$REGION" \
        --delete \
        --exclude ".*" \
        --exclude "__pycache__/*" \
        --exclude "node_modules/*" \
        --exclude "sync-scenarios-to-s3.sh"
    
    echo "✅ Uploaded $scenario_name"
done

echo ""
echo "🎉 All scenarios uploaded successfully!"
echo ""
echo "Available scenarios in S3:"
aws s3 ls "s3://${BUCKET_NAME}/" --region "$REGION"