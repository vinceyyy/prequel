---
alwaysApply: true
---

# Security Rules

## Mandatory Checks Before Commit

- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- Error messages don't leak sensitive data

## Secret Management

Access credentials through environment variables, never hardcode.

## If You Discover a Security Issue

1. Stop current work immediately
2. Address the vulnerability before continuing
3. If credentials were exposed, notify user to revoke them
4. Check for similar issues elsewhere in codebase
