# CLAUDE.md

Operational playbook for AI agents working on **Prequel**. Human-facing overview lives in
`README.md`; design rationale and deep-dives live in `docs/`.

## Agent rules

Always-on engineering rules live in `.claude/rules/` and are imported here:

@.claude/rules/coding-style.md
@.claude/rules/typescript.md
@.claude/rules/git.md
@.claude/rules/security.md
@.claude/rules/context7.md
@.claude/rules/documentation.md
@.claude/rules/github-rulesets.md

## What this is

Prequel provisions on-demand, browser-based VS Code instances for coding interviews. An admin
creates an interview/take-home → Terraform provisions an isolated ECS container running
code-server → the candidate gets a URL + password → the instance auto-destroys on a timer.
Also provides a standalone OpenAI **API Key Manager**. The UI updates live via 1-second polling.

## Architecture

pnpm workspace, two packages, deployed as a **single ECS Fargate service** (Hono serves both
the API and the built SPA):

```
                interview[-dev].blend360.app  (ALB)
                              │
                     ECS Fargate task  (Node 24)
                     Hono :3000
                       ├── /api/*        REST routes (src/routes/*)
                       ├── /health, /api/health
                       ├── scheduler     setInterval at boot (provision/destroy/expiry)
                       └── /* (SPA)       serves frontend/dist from ./public
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
      DynamoDB              S3            terraform + AWS CLI + SSM plugin
   (interviews,        (challenge,        (baked into the image; lib/terraform.ts
    operations,         instance,          shells out to provision per-interview infra)
    challenges,         history)
    apikeys)
```

- **`backend/`** (`@prequel/backend`) — Hono API. `src/server.ts` boots the app + scheduler and
  serves the SPA. `src/routes/*` are thin HTTP handlers over `src/lib/*` (the real logic:
  `terraform`, `operations`, `interviews`, `assessments`, `apikeys`, `scheduler`, `openai`,
  `cleanup`, `config`). `src/middleware/auth.ts` gates `/api/*` (see Auth).
- **`frontend/`** (`@prequel/frontend`) — Vite + React 19 SPA. React Router routes in
  `src/App.tsx`; real-time data via the polling hooks in `src/hooks` (no Zustand/SWR);
  shadcn/ui + Tailwind v4. `src/components/AuthGate.tsx` enforces login client-side.
- **`infra/`** — Terraform. `environments/shared` (VPC/subnets/SGs — **shared with prod**),
  `environments/{dev,prod}` (DynamoDB/S3/ECS/ALB/DNS/ECR), `modules/*`. Per-interview instance
  templates live in `instance/`; challenge content in `challenge/`.

> The app was migrated off Next.js. If you find references to a `portal/` directory or Next.js,
> they're stale — flag them. The instance container (`instance/`) is separate from the portal app.

## Commands

```bash
pnpm install
pnpm run dev            # vp run -r dev: backend (tsx watch) + frontend (vite, proxies /api → :3000)
pnpm run check          # oxfmt + oxlint + tsc, all packages — run before every commit
pnpm run build          # tsup (backend) + vite (frontend)
pnpm run test           # vitest, all packages
pnpm -r exec vp check --fix   # auto-fix formatting/lint

# Deploy (build amd64 image from backend/Dockerfile, push to ECR, force ECS redeploy)
./scripts/build-push-deploy.sh dev     # NEVER pass prod without explicit user consent
```

Toolchain is **vite-plus (`vp`)** = oxlint + oxfmt + Vitest (replaces ESLint/Prettier/Jest).
The backend is bundled with **tsup** (not `tsc`) because `lib/*` uses extensionless imports;
deps are externalized and resolved at runtime. New to `vp`/`vite-plus`? Check Context7 MCP.

## Auth

Passcode → HMAC-signed `auth-token` cookie (30-day, httpOnly, `lib/auth.ts`). When
`ENABLE_AUTH=true`, `authMiddleware` requires a valid cookie on every `/api/*` route **except**
the public allowlist: `/api/auth/{login,logout,me}`, `/api/health`, and the candidate-facing
`/api/apikey/:token/*` and `/api/takehome/:token/*`. The SPA calls `GET /api/auth/me` on load and
redirects to `/login` if unauthenticated. Set `ENABLE_AUTH=false` to open everything (local only).

## Safety rules

1. **Never deploy to or modify prod without explicit user consent.** `shared/` networking is used
   by prod — terraform changes there (e.g. NAT gateway count) affect prod.
2. **Always `terraform plan` and review before `apply`.** Apply only the reviewed plan.
3. **`terraform destroy` and per-environment teardown require explicit approval** — they wipe data.
4. **Never commit secrets.** `terraform.tfvars` (contains OpenAI admin key + passcode) is gitignored;
   never print or commit it.
5. The Docker image **must** retain terraform + AWS CLI v2 + Session Manager plugin — `lib/terraform.ts`
   and file extraction shell out to them.

## Environments

Resources are named `{PROJECT_PREFIX}-{ENVIRONMENT}-{resource}` (prefix `blend360-interview`).
`.env.local` (`AWS_PROFILE`, `ENVIRONMENT`, `PROJECT_PREFIX`, …) must match the deployed infra.
Local dev uses AWS SSO (`aws sso login --profile <profile>`); ECS uses the task IAM role
(auto-detected via `AWS_EXECUTION_ENV`). dev = `interview-dev.blend360.app`,
prod = `interview.blend360.app`.

## Instance status lifecycle

`Scheduled → Initializing → Configuring → Active → Destroying` (`Error` on failure). Scheduled
interviews pre-provision 5 minutes early so they're `Active` exactly at the scheduled time. The
scheduler (`lib/scheduler.ts`, 30s loop) drives scheduling, auto-destroy, take-home expiry, and
API-key lifecycle. See `docs/architecture.md` for details.

## Further docs

`docs/architecture.md`, `docs/api.md`, `docs/data-fetching.md`, `docs/security.md`,
`docs/cleanup.md`. Working notes/plans go in `docs/working/` and are deleted once fulfilled.
