# Terraform Templates Management

The interview instance Terraform code is now stored in S3 instead of being bundled with the NextJS application. This
allows updating the infrastructure-as-code without redeploying the app.

## Project Structure

```
prequel/
├── infra/                          ← Common infrastructure (ALB, ECS, etc)
├── portal/                         ← NextJS application
├── instance/                       ← Interview instance Terraform templates
│   ├── main.tf
│   ├── service.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── sync-to-s3.sh
└── challenge/                      ← Interview challenge files
    ├── python/
    ├── javascript/
    ├── sql/
    └── sync-to-s3.sh
```

## S3 Architecture

```
S3 Bucket: prequel-instance
├── instance/                       ← Template files (source of truth)
│   ├── main.tf
│   ├── service.tf
│   ├── variables.tf
│   └── outputs.tf
├── challenge/                      ← Challenge files
│   ├── python/
│   ├── javascript/
│   └── sql/
└── workspaces/
    └── {interview-id}/              ← Instance-specific workspaces
        ├── main.tf                  ← Generated from templates
        ├── service.tf
        ├── variables.tf
        ├── outputs.tf
        └── terraform.tfvars        ← Runtime configuration
```

## Workflow

### For New Interviews

1. NextJS app downloads templates from `s3://prequel-instance/instance/`
2. Replaces `INTERVIEW_ID_PLACEHOLDER` with actual interview ID
3. Creates `terraform.tfvars` with interview-specific configuration
4. Uploads the complete workspace to `s3://prequel-instance/workspaces/{interview-id}/`

### For Existing Interviews

- Uses the saved workspace from `s3://prequel-instance/workspaces/{interview-id}/`
- This ensures existing interviews aren't affected by template updates

## Updating Templates and Challenges - Using the Sync Scripts

```bash
# From the instance directory
cd instance && ./sync-to-s3.sh

# From the challenge directory
cd challenge && ./sync-to-s3.sh
```

## Benefits

1. **No App Redeployment**: Update Terraform code without rebuilding/redeploying NextJS
2. **Version Control**: S3 versioning keeps track of template changes
3. **Rollback Capability**: Can easily revert to previous template versions
4. **Environment Separation**: Different buckets for dev/staging/prod environments
5. **Hot Updates**: Changes take effect immediately for new interviews

## Important Notes

- Template changes only affect **new interviews**
- Existing interviews continue using their saved workspace versions
- Always test template changes in a development environment first
- The `INTERVIEW_ID_PLACEHOLDER` in `main.tf` is automatically replaced
- Terraform state files are never included in templates

## File Structure

### main.tf

- Contains backend configuration with `INTERVIEW_ID_PLACEHOLDER`
- Defines remote state data source
- Sets up locals and provider configuration

### service.tf

- ECS task definitions and services
- Load balancer rules and target groups
- Security groups and networking

### variables.tf

- Input variable definitions
- Default values and descriptions

### outputs.tf

- Output definitions for interview URL, credentials, etc.
- Used by the NextJS app to get interview details

## Troubleshooting

### Template Download Fails

- Check S3 bucket permissions
- Ensure `prequel-instance` bucket exists
- Verify AWS credentials have S3 read access

### Interview Creation Fails After Template Update

- Check CloudWatch logs for Terraform errors
- Verify template syntax is valid
- Test templates locally before uploading

### Need to Rollback Templates

```bash
# List previous versions
aws s3api list-object-versions --bucket prequel-instance --prefix templates/interview-instance/

# Restore a specific version
aws s3api restore-object --bucket prequel-instance --key templates/interview-instance/service.tf --version-id VERSION_ID
```
