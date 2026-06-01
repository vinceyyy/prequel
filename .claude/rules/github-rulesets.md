---
alwaysApply: false
description: GitHub repository rulesets for the main + dev branching model. Reference when working with branch protection or CI/CD.
globs:
  - ".github/**"
---

# GitHub Repository Rulesets

## Ruleset: Protect dev

**Target:** `refs/heads/dev`

| Rule                                  | Setting                                 |
| ------------------------------------- | --------------------------------------- |
| Prevent deletion                      | Yes                                     |
| Prevent non-fast-forward (force push) | Yes                                     |
| Require pull request                  | Yes, 0 approvals required               |
| Allowed merge methods                 | Squash only                             |
| Require linear history                | Yes                                     |
| Require status checks to pass         | Yes, strict (branch must be up to date) |

## Ruleset: Protect main

**Target:** `refs/heads/main`

| Rule                                  | Setting                   |
| ------------------------------------- | ------------------------- |
| Prevent deletion                      | Yes                       |
| Prevent non-fast-forward (force push) | Yes                       |
| Require pull request                  | Yes, 0 approvals required |
| Allowed merge methods                 | Merge (regular) only      |

## CI/CD Concurrency (companion pattern)

Pair these rulesets with two-tier CI/CD concurrency in GitHub Actions:

```yaml
# Workflow level — cancel stale test jobs
concurrency:
  group: deploy-stg-tests
  cancel-in-progress: true

jobs:
  deploy:
    # Job level — never cancel infra deploys (CloudFormation/SST)
    concurrency:
      group: deploy-stg-infra
      cancel-in-progress: false
```
