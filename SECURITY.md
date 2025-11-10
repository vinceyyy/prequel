# Security Policy

This document outlines security practices and policies for the Prequel project.

## Sensitive Data Protection

### Never Commit

**The following should NEVER be committed to git:**

- ❌ API keys (OpenAI: `sk-*`, AWS: `AKIA*`)
- ❌ Passwords or passcodes
- ❌ `terraform.tfvars` files (use `.example` templates instead)
- ❌ `backend.config` files (use `.example` templates instead)
- ❌ `.env.local` files (use `.env.example` template instead)
- ❌ Private keys (`.pem`, `.key` files)
- ❌ Certificate files (`.crt` files)
- ❌ AWS credentials files

### Always Use

**Follow these practices to keep credentials secure:**

- ✅ `.example` template files with placeholders (e.g., `terraform.tfvars.example`)
- ✅ Environment variables for secrets (loaded via `process.env`)
- ✅ AWS Parameter Store for production secrets (optional)
- ✅ Pre-commit hooks (gitleaks) to prevent accidental commits

## Pre-commit Hook Setup

This repository uses **gitleaks** to automatically scan commits for secrets before they're committed.

### Installation (One-time Setup)

**For macOS (Homebrew):**
```bash
brew install gitleaks
```

**For Linux:**
```bash
# Download latest release
wget https://github.com/gitleaks/gitleaks/releases/download/v8.29.0/gitleaks_8.29.0_linux_x64.tar.gz
tar -xzf gitleaks_8.29.0_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/
```

**For Windows:**
```powershell
# Using Scoop
scoop install gitleaks

# Or download from GitHub releases
# https://github.com/gitleaks/gitleaks/releases
```

### Hook Installation

The pre-commit hook is located at `.git/hooks/pre-commit` and should be automatically active after cloning the repository.

**To manually install/update:**
```bash
# The hook file is already in .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**To verify it's working:**
```bash
# Try to commit a file with a fake secret
echo "FAKE_KEY=sk-abcd1234567890abcd1234567890abcd1234567890ab" > test.txt
git add test.txt
git commit -m "test"
# Should be blocked by gitleaks ✅
```

### Configuration

The gitleaks configuration is in `.gitleaks.toml` and includes:

**Detects:**
- OpenAI API keys (`sk-*`)
- OpenAI Admin keys (`sk-admin-*`)
- OpenAI Project IDs (`proj_*`)
- AWS Access Keys (`AKIA*`)
- AWS Secret Keys
- Sensitive config files (`terraform.tfvars`, `backend.config`, `.env.local`)
- High entropy strings (potential secrets)

**Allows:**
- Test mock credentials (`sk-test*`, `sk-admin-test*`, `proj_test*`)
- Placeholder values (`YOUR-KEY-HERE`, `your-key-here`)
- Example files (`*.example`)
- Test files (`*.test.ts`, `*.spec.ts`)

### Bypassing the Hook (Emergency Only)

**⚠️ WARNING:** Only use `--no-verify` if you're absolutely certain your commit contains no secrets.

```bash
# Skip pre-commit hook (use with extreme caution)
git commit --no-verify -m "your message"
```

**When is it okay to bypass?**
- ✅ Gitleaks false positive after reviewing the finding
- ✅ Updating `.gitleaks.toml` configuration itself
- ❌ "I'm in a hurry" (NOT acceptable - fix the issue instead)
- ❌ "It's just a test key" (use proper `sk-test*` naming instead)

## Credential Management Best Practices

### Local Development

**Environment Variables:**
```bash
# Copy example file
cp .env.example .env.local

# Edit with your credentials
# .env.local is in .gitignore and will never be committed
vim .env.local
```

**AWS Credentials:**
```bash
# Use AWS SSO (recommended)
aws configure sso --profile your-profile
aws sso login --profile your-profile

# Set in .env.local
AWS_PROFILE=your-profile
```

**OpenAI Credentials (Optional):**
```bash
# Get from https://platform.openai.com/
# Add to .env.local
OPENAI_ADMIN_KEY=sk-admin-your-real-key-here
OPENAI_PROJECT_ID=proj_your-project-id
```

### Production Deployment

**Terraform Variables:**
```bash
# Copy example files for each environment
cp infra/environments/prod/terraform.tfvars.example infra/environments/prod/terraform.tfvars
cp infra/environments/prod/backend.config.example infra/environments/prod/backend.config

# Edit with production values (these are gitignored)
vim infra/environments/prod/terraform.tfvars
vim infra/environments/prod/backend.config
```

**ECS Environment Variables:**
- Credentials are injected at runtime via Terraform
- ECS tasks use IAM roles (no hardcoded credentials)
- OpenAI keys stored as ECS environment variables

## Test Credentials

### Naming Conventions

**Always use these patterns for test/mock credentials:**

```typescript
// ✅ Good - clearly marked as test credentials
const testApiKey = 'sk-test123456789'
const testAdminKey = 'sk-admin-test-key'
const testProjectId = 'proj_test123'

// ❌ Bad - looks like a real key
const testApiKey = 'sk-abcd1234567890abcd1234567890abcd1234567890ab'
```

**Why?** Gitleaks allows `sk-test*` and `sk-admin-test*` patterns but blocks real-looking keys.

### Mock Services

**In tests, always mock external services:**

```typescript
// ✅ Good - mock the entire module
jest.mock('@/lib/openai', () => ({
  openaiService: {
    createServiceAccount: jest.fn().mockResolvedValue({
      apiKey: 'sk-test123456789',  // Test key
      serviceAccountId: 'sa-test123'
    })
  }
}))

// ❌ Bad - using real API calls in tests
const apiKey = await openaiService.createServiceAccount(...)
```

## Centralized Configuration

All credentials are managed through the centralized configuration system:

**File:** `portal/src/lib/config.ts`

**Features:**
- ✅ Type-safe configuration with TypeScript
- ✅ Automatic context detection (local vs. ECS)
- ✅ Clear error messages for missing variables
- ✅ Single source of truth for all environment variables
- ✅ Auto-generated resource names (DynamoDB tables, S3 buckets)

**Usage in code:**
```typescript
import { config } from '@/lib/config'

// ✅ Always use config system
const bucket = config.storage.challengeBucket
const apiKey = config.services.openaiAdminKey

// ❌ Never access process.env directly
const bucket = process.env.CHALLENGE_BUCKET  // Don't do this
```

## Incident Response

### If You Accidentally Commit a Secret

**1. DO NOT PUSH** (if you haven't already)
```bash
# Remove the commit
git reset --soft HEAD~1
# Remove the secret from files
# Commit again
```

**2. If Already Pushed to Remote**

This is more serious. Follow these steps:

```bash
# 1. Immediately rotate the credential
# - OpenAI: Revoke and create new key at https://platform.openai.com/
# - AWS: Deactivate and create new keys in IAM console

# 2. Contact the team lead/security team

# 3. Rewrite git history (requires team coordination)
# This is destructive - make a backup first
git clone repo backup-repo
cd repo

# Option A: Remove specific file from history
git filter-repo --path path/to/secret/file --invert-paths

# Option B: Remove specific secret from all files
echo "sk-real-secret==>REDACTED" > replacements.txt
git filter-repo --replace-text replacements.txt

# 4. Force push (after team approval)
git push --force-with-lease

# 5. All team members must re-clone
```

**3. Document the Incident**
- What credential was exposed
- When it was rotated
- How long it was exposed
- What actions were taken

## Security Audit

This repository undergoes regular security audits. The most recent audit findings are in:

- **Main Report:** `docs/security-audit-report-2025-11-10.md`
- **Detailed Findings:** `docs/audit-findings/task*.md`

**Last Audit:** 2025-11-10
**Status:** ✅ PASSED - No security issues found
**Next Audit:** Recommended every 6 months or before major releases

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **DO NOT** open a public GitHub issue
2. Email: [Add your security contact email]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We'll acknowledge receipt within 48 hours and provide a timeline for resolution.

## Security Resources

**Tools:**
- [Gitleaks](https://github.com/gitleaks/gitleaks) - Secret scanning
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

**Documentation:**
- Project CLAUDE.md - Development guidelines
- CONTRIBUTING.md - Contribution workflow

---

**Last Updated:** 2025-11-10
**Next Review:** 2025-05-10
