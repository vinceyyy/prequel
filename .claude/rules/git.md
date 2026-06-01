---
alwaysApply: true
---

# Git Rules

## Branch Safety

- **Always use feature branches** — never commit directly to main or dev
- **Never force push** to main/master or dev

## Branching and Merge Strategy

- Feature branches (`feat/`, `fix/`, `refactor/`) target `dev`, never `main`
- Feature → `dev`: **squash merge** (one clean commit per feature)
- `dev` → `main`: **regular merge commit** (preserves history, marks release boundaries)
- Only `dev` merges into `main` — no feature branches directly to `main`

## Branch Naming

```
feat/description      # New features
fix/description       # Bug fixes
refactor/description  # Code restructuring
```

## Push New Branches

Always use `-u` flag: `git push -u origin HEAD`

## Before Merging

Run the `code-simplifier` skill on the entire codebase before merging or creating a PR. Triage the findings:

- **In-scope issues** (related to the current PR's changes): fix them in this branch
- **Out-of-scope issues** (pre-existing or unrelated): notify the user, write a plan to `docs/working/`, and address them in a separate branch/PR

## Pull Request Format

```markdown
## Summary

[2-4 bullet points covering ALL changes — analyze full branch, not just latest commit]

## Test plan

- [ ] Verification steps as a checklist
```
