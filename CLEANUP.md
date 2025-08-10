# AWS Resource Cleanup System

This document describes the comprehensive cleanup system for managing dangling AWS resources and terraform workspaces that may be left behind due to failed operations or corrupted state.

## Overview

The cleanup system provides three interfaces for managing dangling resources:

1. **Command Line Script** - `cleanup-resources.js` for server-side execution
2. **API Endpoint** - `/api/admin/cleanup` for programmatic access
3. **Web UI** - Admin tab in the portal for interactive cleanup

## Problem Statement

When interview creation or destruction operations fail, AWS resources and terraform workspace files may be left behind in S3. This creates:

- **Cost Issues**: Forgotten ECS services, ALBs, and other resources continue charging
- **Resource Clutter**: Accumulation of unused workspaces and terraform state files
- **Manual Cleanup**: Tedious process to identify and remove dangling resources

## Architecture

### Components

- **`CleanupService`** (`portal/src/lib/cleanup.ts`) - Core cleanup logic
- **API Endpoint** (`portal/src/app/api/admin/cleanup/route.ts`) - REST API interface
- **CLI Script** (`cleanup-resources.js`) - Command-line interface
- **UI Component** (`portal/src/components/CleanupDashboard.tsx`) - Web interface

### Resource Discovery

1. **Workspace Scanning**: Lists all terraform workspaces in S3 bucket `{prefix}-{env}-instance/workspaces/`
2. **State Validation**: Checks which interviews still exist in DynamoDB
3. **Dangling Identification**: Compares S3 workspaces against active interviews
4. **Resource Mapping**: Identifies AWS resources associated with each workspace

### Cleanup Process

1. **ECS Service Scaling**: Scale down running containers to 0 tasks
2. **Terraform Destroy**: Use existing terraform workspace to destroy infrastructure
3. **Fallback Cleanup**: Direct AWS CLI cleanup if terraform state is corrupted
4. **Workspace Removal**: Delete S3 workspace files after successful destruction

## Usage

### Command Line Interface

```bash
# Navigate to project root
cd /path/to/prequel

# Preview what would be cleaned up (dry run)
node cleanup-resources.js --dry-run

# Clean up only dangling resources
node cleanup-resources.js

# Force cleanup including active interviews
node cleanup-resources.js --force-destroy

# List dangling resources without cleanup
node cleanup-resources.js --list-only

# Advanced options
node cleanup-resources.js \
  --max-concurrency=2 \
  --timeout=300 \
  --dry-run
```

**Command Options:**
- `--dry-run`: Preview changes without executing
- `--force-destroy`: Clean up active interviews too
- `--max-concurrency=N`: Concurrent operations (1-10, default: 3)
- `--timeout=N`: Timeout per operation (60-1800s, default: 300)
- `--list-only`: Show dangling resources only
- `--help`: Show usage help

### API Interface

```bash
# List dangling resources
curl "http://localhost:3000/api/admin/cleanup"

# Dry run cleanup
curl -X POST "http://localhost:3000/api/admin/cleanup?dryRun=true"

# Actual cleanup
curl -X POST "http://localhost:3000/api/admin/cleanup"

# Force cleanup with options
curl -X POST "http://localhost:3000/api/admin/cleanup?forceDestroy=true&maxConcurrency=2"
```

### Web Interface

1. Access the portal at `http://localhost:3000` (or your deployed URL)
2. Navigate to the **Admin** tab
3. Click **"Scan for Dangling Resources"** to discover issues
4. Use the cleanup buttons:
   - **Preview Cleanup**: Dry run to see what would be cleaned
   - **Clean Dangling Resources**: Remove only orphaned workspaces
   - **Force Clean All Resources**: Remove everything (dangerous!)

## Safety Features

### Dry Run Mode
Preview all cleanup operations before execution:
```bash
node cleanup-resources.js --dry-run
```

### Active Interview Protection
By default, workspaces with active interviews in DynamoDB are skipped. Use `--force-destroy` only when necessary.

### Concurrency Control
Limit concurrent operations to prevent AWS API throttling:
```bash
node cleanup-resources.js --max-concurrency=2
```

### Timeout Management
Set reasonable timeouts for terraform operations:
```bash
node cleanup-resources.js --timeout=600  # 10 minutes
```

### Comprehensive Logging
Detailed logs show exactly what resources are being cleaned up and why.

## Configuration

### Required Environment Variables

```bash
# AWS Configuration
AWS_PROFILE=your-aws-profile      # For local development
AWS_REGION=us-east-1              # AWS region

# Project Configuration  
PROJECT_PREFIX=prequel            # Must match infrastructure
ENVIRONMENT=dev                   # Must match terraform.tfvars

# Optional Configuration
LOG_LEVEL=info                    # debug/info/warn/error
```

### Environment Files

Create `.env.local` in the portal directory:
```bash
AWS_PROFILE=your-aws-profile
AWS_REGION=us-east-1
PROJECT_PREFIX=prequel
ENVIRONMENT=dev
LOG_LEVEL=debug
```

## Resource Types Cleaned

### AWS Resources
- **ECS Services**: `interview-{id}` services and tasks
- **Load Balancers**: Dedicated ALBs for interviews
- **Target Groups**: ALB target groups
- **Route53 Records**: DNS records for subdomains
- **Security Groups**: ECS and ALB security groups
- **SSM Parameters**: Password storage parameters

### Storage Resources
- **S3 Workspaces**: Terraform workspace files
- **Terraform State**: Infrastructure state files (in some cases)

## Error Handling

### Terraform State Issues
- **Missing Workspace**: Falls back to direct AWS CLI cleanup
- **Corrupted State**: Attempts provider permission fixes
- **Init Failures**: Multiple retry strategies

### AWS API Errors
- **Rate Limiting**: Controlled concurrency prevents throttling
- **Permission Issues**: Clear error messages for missing permissions
- **Resource Dependencies**: Graceful handling of dependency ordering

### Partial Failures
- **Continue on Error**: Process remaining resources even if some fail
- **Detailed Reporting**: Show exactly which resources failed and why
- **Preserve State**: Keep workspace files if terraform destroy fails

## Monitoring and Reporting

### Summary Metrics
```typescript
{
  workspacesFound: number
  workspacesDestroyed: number  
  workspacesSkipped: number
  workspacesErrored: number
  danglingResourcesFound: number
  danglingResourcesCleaned: number
}
```

### Individual Results
```typescript
{
  interviewId: string
  status: 'destroyed' | 'skipped' | 'error'
  reason?: string
  error?: string
}
```

### Execution Logs
Detailed step-by-step logs showing:
- Resource discovery process
- Terraform operations
- AWS API calls
- Success/failure reasons

## Security Considerations

### Access Control
- **Admin Endpoint**: API endpoints should be protected in production
- **AWS Permissions**: Requires full access to ECS, ALB, Route53, EC2, S3, SSM
- **Destructive Operations**: Irreversible resource deletion

### Production Safety
- **Always Test First**: Use dry run mode in production
- **Backup Critical Data**: Ensure important data is backed up
- **Staged Rollout**: Clean up small batches first
- **Team Communication**: Coordinate with team before large cleanups

## Troubleshooting

### Common Issues

1. **AWS Credentials**
   ```bash
   # Refresh SSO credentials
   aws sso login --profile your-profile
   ```

2. **Missing Resources**
   ```bash
   # Verify bucket exists
   aws s3 ls s3://your-prefix-env-instance/
   ```

3. **Terraform Errors**
   ```bash
   # Check terraform state
   node cleanup-resources.js --list-only
   ```

4. **Permission Errors**
   ```bash
   # Verify AWS permissions
   aws sts get-caller-identity
   ```

### Debug Mode
Enable detailed logging:
```bash
LOG_LEVEL=debug node cleanup-resources.js --dry-run
```

## Best Practices

### Regular Maintenance
- Run cleanup checks weekly to prevent resource accumulation
- Monitor AWS costs for unexpected resource usage
- Set up alerts for long-running ECS services

### Before Large Operations
- Always run dry run first
- Coordinate with team members
- Have rollback plan ready
- Test in development environment

### Production Usage
- Use conservative concurrency settings (1-2)
- Set longer timeouts for complex resources
- Never use `--force-destroy` without explicit approval
- Keep detailed logs of all cleanup operations

## Integration

### CI/CD Pipelines
Add cleanup as a maintenance task:
```yaml
- name: Cleanup Dangling Resources
  run: |
    cd portal
    node ../cleanup-resources.js --dry-run
    # Only proceed if dry run looks good
    node ../cleanup-resources.js
```

### Monitoring Systems
Integrate with monitoring to track resource usage and cleanup effectiveness.

### Cost Management
Use cleanup reports to understand and optimize AWS spending patterns.

## Support

For issues or questions about the cleanup system:

1. Check the execution logs for detailed error information
2. Verify AWS credentials and permissions
3. Test with dry run mode first
4. Review this documentation for troubleshooting steps
5. Contact the development team with specific error messages

The cleanup system is designed to be safe and comprehensive, but always exercise caution when dealing with destructive operations in production environments.