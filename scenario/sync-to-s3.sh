#!/bin/bash

# Sync scenario files to S3
# This allows updating scenarios without redeploying the NextJS app

set -e

AWS_PROFILE=${AWS_PROFILE:-"your-aws-profile"}
S3_BUCKET="prequel-instance"
S3_PATH="s3://${S3_BUCKET}/scenario/"
LOCAL_PATH="."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --dry-run, -d      Show what would be synced without actually syncing"
    echo "  --help, -h         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                 # Sync scenario files"
    echo "  $0 --dry-run       # Preview what would be synced"
}

# Parse command line arguments
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
echo "🚀 Scenario Files Sync Script"
echo "============================="
echo "AWS Profile: ${AWS_PROFILE}"
echo "S3 Bucket: ${S3_BUCKET}"
echo "Local Path: ${LOCAL_PATH}"
echo "S3 Path: ${S3_PATH}"
echo "Dry Run: ${DRY_RUN}"
echo ""

# Check if we're in the right directory
if [ ! -d "python" ] && [ ! -d "javascript" ] && [ ! -d "sql" ]; then
    print_error "Please run this script from the scenario directory"
    exit 1
fi

# Add --dryrun flag if specified
DRY_RUN_FLAG=""
if [ "$DRY_RUN" = true ]; then
    DRY_RUN_FLAG="--dryrun"
    print_warning "DRY RUN MODE - No files will actually be uploaded"
    echo ""
fi

print_status "Syncing scenario files..."
echo "  Source: ${LOCAL_PATH}"
echo "  Destination: ${S3_PATH}"
echo ""

# Build the AWS CLI command with exclusions
cmd="AWS_PROFILE=${AWS_PROFILE} aws s3 sync \"${LOCAL_PATH}\" \"${S3_PATH}\" --delete"
cmd="${cmd} --exclude \"*.md\" --exclude \"README*\""

# Add dry run flag if specified
if [ -n "${DRY_RUN_FLAG}" ]; then
    cmd="${cmd} ${DRY_RUN_FLAG}"
fi

# Execute the sync command
if eval $cmd; then
    print_success "Scenario files synced successfully!"
    echo ""
    print_status "Files in S3:"
    AWS_PROFILE=${AWS_PROFILE} aws s3 ls "${S3_PATH}" --recursive | head -20
    echo ""
    if [ "$DRY_RUN" = false ]; then
        print_status "The NextJS app will now use the updated scenario files for new interviews."
    fi
else
    print_error "Failed to sync scenario files"
    exit 1
fi