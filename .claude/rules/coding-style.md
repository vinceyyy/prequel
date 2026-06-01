---
alwaysApply: true
---

# Coding Style

## Before Writing Code

- State assumptions explicitly before implementation
- Enumerate input constraints and environment requirements
- Identify what would cause failure
- Bound scope explicitly — solve the asked problem, not more

## During Code

- Smaller is better — less speculation, more focus
- Handle edge cases or explicitly reject them
- Error paths receive equal consideration as happy paths

## After Code

- Document what's handled AND what's not handled
- State conditions under which the code is correct
- Known limitations are documented, not hidden

## File Organization

- Many small files > few large files
- Target: 200-400 lines typical, 800 lines maximum
- High cohesion, low coupling
- Organize by feature/domain, not file type
