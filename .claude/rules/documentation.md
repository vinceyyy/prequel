---
alwaysApply: false
description: Documentation standards for README.md, CLAUDE.md, and docs/. Reference when creating or updating documentation.
globs:
  - "*.md"
  - "docs/**"
---

# Documentation Rules

## Dual Audience

Every project maintains two high-level entry points:

- `README.md` — human entry point (what this is, why it exists, quick start)
- `CLAUDE.md` — AI entry point (build commands, constraints, file layout)

Some overlap between these two is fine — they serve different audiences who won't read each other's doc.

## Detailed Docs

Detailed documentation lives in `docs/`. It should contain ideas, rationale, architecture decisions, and design reasoning — not code. Humans won't read code in docs; AI can read source directly.

## No Repetition

Within the same audience, each piece of information lives in exactly one place. Don't repeat the same thing across multiple human-facing docs, or across multiple AI-facing files. Link instead of copying.

## Evergreen vs Working Docs

Everything directly in `docs/` must be evergreen — permanently useful reference material.

Working documents (plans, task trackers, design explorations, redesign notes) go in `docs/working/` or a similar subfolder. These are checked into version control during development, but deleted from the main branch once their purpose is fulfilled.

## CC Responsibilities

- When creating features: suggest `docs/` updates alongside code
- `docs/` must be readable without AI context
- `CLAUDE.md` must be actionable without reading all of `docs/`
- Point to `docs/` with motivation: explain WHEN and WHY to read each file
