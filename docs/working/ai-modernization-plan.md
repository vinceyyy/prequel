# Modernization Plan — migrate prequel to the blend-share standard

**Status:** awaiting approval
**Author:** AI agent (Claude Code)
**Date:** 2026-06-01
**Goal:** Drop Next.js; rebuild prequel as a pnpm workspace with a **Hono backend + Vite
React SPA**, on the **vite-plus / oxlint / oxfmt / Vitest** toolchain — matching the
`blend-share` reference repo — and add the AI-dev + code-health scaffolding (rules, CI,
dependency/release automation, MCP, plugins) on the way.

## Decisions locked (from scoping)

- **Cutover:** big-bang on a single branch (`feat/vite-migration`), flip in one PR.
- **Frontend:** Vite + React SPA, **React Router** (prequel has 9 routes incl. dynamic
  `[token]` pages — more than blend-share's hand-rolled-router scale), **keep the existing 5
  polling hooks** (the product's real-time core; already framework-agnostic `fetch()`),
  shadcn/ui (base-nova) + Tailwind v4 + lucide. **No Zustand, no SWR.**
- **Backend:** Hono 4.6 + `@hono/node-server`. Keep prequel's **HMAC passcode auth** (ported to
  Hono cookies) — *not* blend-share's Cognito/better-auth. `src/lib/*` ports nearly untouched.
- **Infra:** in scope — multi-stage Docker (SPA baked into the backend image, served by Hono) +
  ECS task-definition updates.
- **Scaffolding:** full set (`.claude/rules`, plugins, MCP, CI, dependabot, release-please,
  dev/main branch model), adapted to the new pnpm/vite-plus layout.

## Why this is viable (verified, not assumed)

- prequel is effectively a SPA already: 9 client pages, 15 `'use client'` components, 1-second
  polling, **zero SSR/RSC usage**. Next.js earns nothing here.
- **`src/lib/*` has zero `next/*` imports** — terraform, operations, scheduler, openai, config,
  logger, AWS SDK all port to the Hono backend as-is.
- The **36 API routes are thin glue** over that lib layer (42 of 50 `next/*` imports are just
  `NextRequest`/`NextResponse`). Rewriting them to Hono is mechanical.
- The scheduler is a module-load `setInterval` singleton — in Hono it's just imported at boot
  (cleaner than Next's instrumentation hack).

---

## Target architecture

```
                  interview.<domain>  (ALB)
                          │
                          ▼
                 ECS Fargate task
                 Hono (Node 24) :3000
                   ├── /api/*        → route handlers (ported from src/app/api)
                   ├── /health
                   ├── scheduler     → setInterval at boot (terraform/AWS ops)
                   └── /* (SPA)       → serves frontend/dist (built React bundle)
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
        DynamoDB         S3        terraform CLI + AWS CLI + SSM plugin
     (interviews,    (challenge,    (in-container, unchanged)
      operations,     instance,
      challenges,     history)
      apikeys)
```

Single ECS service/task (as today) — Hono serves both the API and the static SPA, so no second
service or ALB rule is needed. terraform/AWS-CLI/SSM-plugin tooling stays baked into the image.

## Repo layout

**Before** → **After**

```
portal/                  →  REMOVED (split below)
                            frontend/        (@prequel/frontend — Vite React SPA)
                            backend/         (@prequel/backend  — Hono service)
                            pnpm-workspace.yaml
                            tsconfig.base.json
                            package.json      (root: vp run -r scripts)
                            .npmrc            (node-linker=hoisted)
infra/                   →  infra/            (task def + Dockerfile path updates)
instance/                →  instance/         (unchanged)
challenge/               →  challenge/        (unchanged)
.github/ (none)          →  .github/          (CI, dependabot, release-please)
.claude/ (minimal)       →  .claude/          (rules + plugins + settings merge)
.mcp.json (none)         →  .mcp.json, opencode.json
docs/                    →  docs/             (+ this plan in docs/working/)
```

---

## Phase 0 — Branch + workspace skeleton

1. Create `dev` from `main`; `git push -u origin dev`. Branch `feat/vite-migration` off `dev`.
2. Root files:
   - `pnpm-workspace.yaml` → packages `frontend`, `backend`.
   - `.npmrc` → `node-linker=hoisted`.
   - `tsconfig.base.json` → copy blend-share's (ES2024, NodeNext, strict, `noUncheckedIndexedAccess`, etc.).
   - root `package.json` → `name: prequel`, scripts `dev/build/check/typecheck/lint/fmt` =
     `vp run -r <x>`, `vite-plus` + `typescript` devDeps, `packageManager: pnpm@<latest>`,
     `engines.node >=24`.
   - root `vite.config.ts` → `staged: { "*": "vp check --fix" }` (pre-commit).
3. Delete `portal/` after its contents are relocated (end of Phase 2), not now.

## Phase 1 — Backend (`backend/`, Hono)

Layout:
```
backend/
  src/
    server.ts            # Hono app + @hono/node-server serve() on :3000
    env.ts               # typed env access (replaces scattered process.env)
    lib/                 # ← moved from portal/src/lib (near-verbatim)
    routes/
      auth.ts            # /api/auth/login, /logout  (HMAC cookie, ported)
      interviews.ts      # /api/interviews/*
      takehomes.ts       # /api/takehomes/*
      operations.ts      # /api/operations/*  (incl. SSE-style logs)
      apikeys.ts         # /api/apikeys/*, /api/apikey/:token/* (public)
      challenges.ts      # /api/challenges/*  (upload formData + binary download + catchall)
      admin.ts           # /api/admin/cleanup
      health.ts          # /health
  Dockerfile             # multi-stage (see Phase 5)
  tsconfig.json          # extends ../tsconfig.base.json, outDir dist
  vite.config.ts         # vitest + oxlint/oxfmt config (blend-share shape)
  package.json           # @prequel/backend
```

Backend work items:
1. **Move `portal/src/lib/*` → `backend/src/lib/*`** unchanged, except `config.ts`: strip
   Next-only build detection (`NEXT_PHASE`, `isRunningDuringBuild()`); keep ECS vs local SSO
   detection (`AWS_EXECUTION_ENV`, `AWS_PROFILE`).
2. **`server.ts`**: `const app = new Hono()`; `app.use('*', logger())`; mount routers under
   `/api`; `app.get('/health', …)`; static SPA serving (`serveStatic({ root: './public' })` +
   SPA fallback to `index.html` for non-`/api` non-asset paths); `serve({ fetch: app.fetch,
   port: 3000 })`. **`import './lib/scheduler'`** at top so the scheduler `setInterval` starts at
   boot (and gate it behind an env flag so it doesn't run during local frontend-only dev).
3. **Port 36 route handlers** — mechanical mapping:
   | Next pattern | Hono equivalent |
   | --- | --- |
   | `NextResponse.json(x, {status})` | `c.json(x, status)` |
   | `await request.json()` | `await c.req.json()` |
   | `new URL(request.url).searchParams.get('k')` | `c.req.query('k')` |
   | `const {id} = await params` | `c.req.param('id')` |
   | `[...path]` catchall | `c.req.param('path')` on `/files/:path{.+}` route |
   | `response.cookies.set('auth-token', …)` | `setCookie(c, 'auth-token', …)` (hono/cookie) |
   | `request.formData()` upload | `await c.req.formData()` / `c.req.parseBody()` |
   | binary `new Response(buffer,{headers})` | `c.body(buffer, 200, headers)` |
   | SSE `ReadableStream` (destroy/logs) | `streamSSE(c, async (s)=>…)` (hono/streaming) |
4. **Auth middleware**: port `validateSessionToken` from `lib/auth.ts`; add a Hono middleware
   that enforces the `auth-token` cookie on `/api/*` **when `ENABLE_AUTH=true`**, with the public
   exceptions (`/api/apikey/:token/*`, `/api/takehome/:token/*`, `/api/auth/login`, `/health`).
   (Today enforcement is loose; this tightens it correctly during the move.)
5. **Vitest**: port the existing Jest unit tests in `portal/src/lib/__tests__` to Vitest
   (mostly `jest.fn`→`vi.fn`, `jest.mock`→`vi.mock`). Coverage thresholds like blend-share.

## Phase 2 — Frontend (`frontend/`, Vite + React SPA)

Layout:
```
frontend/
  index.html
  src/
    main.tsx             # ReactDOM root + <BrowserRouter>
    App.tsx              # <Routes> (React Router)
    index.css            # Tailwind v4 entry (@import "tailwindcss")
    lib/
      api.ts             # fetch wrapper (baseURL, 401 → /login)
      utils.ts           # cn() (clsx + tailwind-merge)
    hooks/               # ← moved from portal/src/hooks (polling hooks kept as-is)
    components/          # ← moved from portal/src/components (next/* removed)
      ui/                # shadcn/ui (base-nova)
    pages/               # ← from portal/src/app/*/page.tsx
      InterviewsPage.tsx, TakehomesPage.tsx, ApiKeysPage.tsx, ChallengesPage.tsx,
      AdminPage.tsx, LoginPage.tsx, ApiKeyActivatePage.tsx ([token]),
      TakeHomeActivatePage.tsx ([token])
  components.json        # shadcn config (style base-nova, rsc:false, aliases @/)
  vite.config.ts         # react + tailwind plugins, @ alias, dev proxy /api→:3000, vitest, oxlint
  tsconfig.json / tsconfig.app.json / tsconfig.node.json
  package.json           # @prequel/frontend
```

Frontend work items:
1. **Routing**: React Router `<Routes>`. Map the 9 pages; dynamic `[token]` → `:token` with
   `useParams`. Replace `next/link`→`<Link>`, `usePathname`→`useLocation`, `useRouter().push`→
   `useNavigate`, `useParams` (next)→`useParams` (RR).
2. **Keep polling hooks unchanged** — they already call `fetch('/api/…')`. Add a thin `api.ts`
   base so dev hits the Vite proxy and prod hits same-origin.
3. **Fonts**: replace `next/font/google` with a `@fontsource/*` package or a `<link>` in
   `index.html`.
4. **Drop all `'use client'`** directives (everything is client in a SPA).
5. **Auth state**: small `useAuth` (reads a `/api/auth/me` check or the `NEXT_PUBLIC_ENABLE_AUTH`
   equivalent exposed via Vite `import.meta.env.VITE_ENABLE_AUTH`); redirect to `/login` on 401.
6. **shadcn/ui**: init (`components.json`, `ui/` primitives, `cn()`), Tailwind v4 via
   `@tailwindcss/vite`. Migrate existing component styling onto shadcn primitives incrementally
   (start by wrapping; full visual parity is a polish pass, not a blocker).
7. **Playwright**: keep `portal/e2e` specs, point `webServer` at the new dev command.

## Phase 3 — Toolchain (vite-plus / oxlint / oxfmt / Vitest / pnpm)

1. Replace ESLint+Prettier+Jest with **vite-plus** (`vp`): lint/fmt/test config lives inside each
   package's `vite.config.ts` (oxlint plugins `typescript`/`react`, oxfmt rules), per blend-share.
2. Remove `eslint*`, `prettier*`, `jest*`, `next`, `eslint-config-next`, `.eslintrc`,
   `jest.config.js`, `next.config.ts`, `next-env.d.ts`, `portal/scripts/test-*.sh`.
3. `pnpm import` from the old `package-lock.json` is not meaningful across the restructure — write
   fresh `package.json`s and `pnpm install` to generate `pnpm-lock.yaml`.
4. Root scripts mirror blend-share: `vp run -r {dev,build,check,typecheck,lint,fmt}`.

## Phase 4 — AI-dev + code-health scaffolding (adapted to the new layout)

1. **`.claude/rules/`** (7): copy `coding-style.md`, `git.md`, `security.md`, `documentation.md`,
   `github-rulesets.md`, `context7.md` verbatim. `typescript.md`: copy blend-share's **as-is now**
   (it already documents exactly this stack — vite-plus, oxlint, shadcn, Tailwind v4) — only adjust
   the "Zustand for global state" line to note prequel uses local state + polling hooks. Wire into
   `CLAUDE.md` via `@`-imports.
2. **`.claude/settings.json`** (merge, keep existing permissions+superpowers): add `blend360`
   marketplace + the official plugin set (code-review, code-simplifier, feature-dev,
   commit-commands, frontend-design, agent-sdk-dev, playwright, typescript-lsp,
   claude-md-management, episodic-memory, blend-branding).
3. **`.mcp.json`** (Context7) + **`opencode.json`** (instructions, context7+playwright MCP,
   superpowers). Document `CONTEXT7_API_KEY` in `.env.example`.
4. **`.github/workflows/ci.yml`** — copy blend-share's structure (it's already pnpm + `vp run -r
   check` + build + Vitest coverage + Playwright). prequel adaptation: single root install;
   `check` + `build` + `unit` jobs run clean; **Playwright e2e job disabled by default**
   (it boots the app against live AWS — `if: false` + comment); add a **terraform fmt/validate**
   job for `infra/`.
5. **`.github/dependabot.yml`** — npm at `/` (pnpm workspace), github-actions at `/`, docker at
   `/backend` and `/instance`; grouped weekly; target `dev`.
6. **release-please** — `.release-please-config.json` (release-type node, single package, bump
   `frontend/package.json` + `backend/package.json` versions), manifest, seed `CHANGELOG.md`,
   workflow using the **simple `GITHUB_TOKEN`** variant (drop blend-share's GitHub-App machinery —
   that's an enterprise-policy workaround prequel doesn't need). Target `main`.

## Phase 5 — Infra (Docker + ECS)

1. **`backend/Dockerfile`** — multi-stage like blend-share, **plus prequel's existing tooling**:
   - stage `frontend-build`: pnpm install + `vp build` → `frontend/dist`.
   - stage `backend-build`: pnpm install + `tsc` → `backend/dist`.
   - stage `runtime`: Node 24, prod deps, copy `backend/dist` + `frontend/dist`→`./public`;
     **re-install terraform + AWS CLI v2 + Session Manager plugin** (currently in
     `portal/Dockerfile`) — these are required by `lib/terraform.ts` and file extraction.
     Entry: `node backend/dist/server.js`.
2. **`infra/`** — update the portal task definition + `bootstrap-portal-image.sh` build context
   to the new Dockerfile path; container still listens on the same port behind the same ALB rule.
   No new AWS resources. (The stray `infra/environments/shared/errored.tfstate` gets gitignored.)
3. Update `portal/build-push-deploy.sh` → `backend/build-push-deploy.sh` paths, and the other
   build scripts referencing `portal/`.

## Phase 6 — Cutover, verification, cleanup

1. Local: `pnpm install`; `pnpm run -r check`; `pnpm run -r build`; `pnpm run -r test`.
2. `pnpm --filter @prequel/backend dev` + `pnpm --filter @prequel/frontend dev` (Vite proxy) →
   click through all 9 pages, login, create/destroy interview (against sandbox AWS), polling live.
3. `terraform fmt -check -recursive infra` + `terraform validate`.
4. Build the Docker image, run locally, hit `/health` + the SPA + an API route.
5. Open PR `feat/vite-migration` → `dev`; CI green.
6. Apply GitHub branch-protection rulesets (Phase 4) wired to the now-existing checks.
7. Update `CLAUDE.md` and `README.md` to the new architecture/commands (operational, de-duped per
   `documentation.md`). Delete this working doc once merged.
8. Deploy to **dev** ECS, smoke-test, then prod (with explicit consent — never auto-deploy prod).

---

## Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **Hono SSE behaves differently than Next ReadableStream** (destroy/logs streaming) | med | Use `hono/streaming` `streamSSE`; test the destroy flow end-to-end before cutover. |
| **formData upload size/streaming differences** (challenge upload) | med | Verify large multi-file uploads through Hono `parseBody`; bump body-limit middleware if needed. |
| **Auth tightening breaks a public flow** (apikey/takehome candidate links) | med | Explicit public-route allowlist + e2e on candidate activation before merge. |
| **vite-plus (`vp`) is new/young (^0.1.x)** | med | It's the blend-share standard; pin the version. Context7 MCP for current docs (per rules). |
| **Jest→Vitest test port drops coverage** | low | Port tests 1:1; CI coverage gate catches regressions. |
| **Docker image misses terraform/AWS-CLI/SSM tooling** | high-impact | Explicitly carry those RUN steps from `portal/Dockerfile`; smoke-test create+destroy in dev. |
| **Big-bang branch goes stale vs main** | med | Freeze non-urgent main changes during the window; rebase frequently; it's an internal tool. |
| **shadcn visual parity takes longer than expected** | low | Functional parity is the merge gate; visual polish is a fast-follow, tracked separately. |

## Out of scope

- No product/AI features (dev-experience + code-health only).
- No dependency *upgrades* beyond what the toolchain swap requires (deps are already current).
- No change to terraform resource topology (only Dockerfile path + task-def image wiring).
- No Cognito/SSO/better-auth adoption — prequel keeps its passcode auth.
- Refactoring oversized lib files (terraform.ts 1631 lines, etc.) to the new 800-line rule:
  recorded as **follow-up `refactor/` PRs**, not done here.

## Verification (definition of done)

- `pnpm run -r check && pnpm run -r build && pnpm run -r test` green locally.
- `terraform fmt -check -recursive infra` + `terraform validate` green.
- All 9 pages function; login + an interview create→active→destroy cycle works against sandbox AWS;
  1-second polling updates live; candidate apikey/takehome links work.
- Docker image runs, serves SPA + `/api` + `/health`, and can shell terraform/AWS CLI/SSM.
- CI green on the PR to `dev`; branch-protection rulesets applied.
- `.claude/rules/*` load in a fresh Claude Code session.
