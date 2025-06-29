#!/bin/bash

# Comprehensive sync script for Prequel project
# Syncs both instance Terraform and scenarios to S3

set -e

AWS_PROFILE=${AWS_PROFILE:-"your-aws-profile"}
S3_BUCKET="prequel-instance"

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
    echo "  --instance, -i     Sync only instance Terraform templates"
    echo "  --scenario, -s     Sync only scenario files"
    echo "  --all, -a          Sync both instance and scenarios (default)"
    echo "  --dry-run, -d      Show what would be synced without actually syncing"
    echo "  --help, -h         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                 # Sync everything"
    echo "  $0 --instance      # Sync only instance Terraform"
    echo "  $0 --scenario      # Sync only scenarios"
    echo "  $0 --dry-run       # Preview what would be synced"
}

# Parse command line arguments
SYNC_INSTANCE=true
SYNC_SCENARIO=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance)
            SYNC_INSTANCE=true
            SYNC_SCENARIO=false
            shift
            ;;
        -s|--scenario)
            SYNC_INSTANCE=false
            SYNC_SCENARIO=true
            shift
            ;;
        -a|--all)
            SYNC_INSTANCE=true
            SYNC_SCENARIO=true
            shift
            ;;
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
echo "🚀 Prequel S3 Sync Script"
echo "=========================="
echo "AWS Profile: ${AWS_PROFILE}"
echo "S3 Bucket: ${S3_BUCKET}"
echo "Dry Run: ${DRY_RUN}"
echo ""

# Check if we're in the right directory (project root)
if [ ! -d "instance" ] || [ ! -d "scenario" ] || [ ! -d "portal" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

success_count=0
total_count=0

# Sync instance templates
if [ "$SYNC_INSTANCE" = true ]; then
    total_count=$((total_count + 1))
    print_status "Syncing instance Terraform templates..."
    
    cd instance
    if [ "$DRY_RUN" = true ]; then
        ./sync-to-s3.sh --dry-run
    else
        ./sync-to-s3.sh
    fi
    
    if [ $? -eq 0 ]; then
        success_count=$((success_count + 1))
    fi
    cd ..
    echo ""
fi

# Sync scenarios
if [ "$SYNC_SCENARIO" = true ]; then
    total_count=$((total_count + 1))
    print_status "Syncing scenario files..."
    
    cd scenario
    if [ "$DRY_RUN" = true ]; then
        ./sync-to-s3.sh --dry-run
    else
        ./sync-to-s3.sh
    fi
    
    if [ $? -eq 0 ]; then
        success_count=$((success_count + 1))
    fi
    cd ..
    echo ""
fi

# Summary
echo "=========================="
if [ $success_count -eq $total_count ]; then
    print_success "All sync operations completed successfully! ($success_count/$total_count)"
    if [ "$DRY_RUN" = false ]; then
        echo ""
        print_status "The NextJS app will now use the updated files for new interviews."
        print_warning "Existing interviews will continue using their saved workspace versions."
    fi
else
    print_error "Some sync operations failed ($success_count/$total_count successful)"
    exit 1
fi