# Stability Improvements Design

## Problem Statement

The portal experiences issues after running in ECS for a period:

- Login stops working
- Debugger statements appear in production bundles when DevTools is open
- CPU/memory usage at 16%
- SSE architecture adds debugging complexity

A security advisory recommends upgrading Next.js to address vulnerabilities.

## Solution Overview

Three-phase approach to address security, simplify architecture, and improve observability.

## Phase 1: Critical Fixes

**Goal:** Address security vulnerability and improve debugging capability.

### 1.1 Next.js Upgrade (15.3.4 → 16.x)

- Update `next` package and `eslint-config-next`
- Review Next.js 16 migration guide for breaking changes
- Check: App Router changes, middleware behavior, cookie handling
- Update `next.config.ts` for any deprecated options
- Test build and all API routes

### 1.2 Login Logging

Add structured logging to authentication flow:

- Login attempts (timestamp, success/failure)
- Cookie set/read operations
- Middleware auth checks
- Session expiry events

### 1.3 Verify Production Build

- Confirm `NODE_ENV=production` in container
- Verify no `debugger` statements in bundles
- Ensure source maps disabled for production browser

**Files:**

- `package.json`
- `src/app/api/auth/login/route.ts`
- `src/middleware.ts`
- `next.config.ts`

---

## Phase 2: Simplification

**Goal:** Reduce complexity by replacing SSE with polling and using proper auth library.

### 2.1 Replace SSE with Simple Polling

Remove SSE infrastructure, implement simple 1-second polling:

**Polling strategy:**

- Fixed 1-second interval for all operations
- Uses `activeOnly=true` query parameter for efficient DynamoDB GSI queries
- Negligible overhead: ~$0.16/month per active user

**Changes:**

- Delete `src/app/api/events/route.ts`
- Delete `src/hooks/useSSE.ts`
- Create `src/hooks/usePolling.ts` with simple interval logic
- Update page components to use polling
- Remove SSE event listeners from operations and scheduler
- Replace connection indicator with "last updated" timestamp

### 2.2 Migrate to better-auth

Replace hand-rolled auth with better-auth:

**Configuration:**

- Simple passcode validation (same as current)
- Secure session/cookie handling
- CSRF protection

**Changes:**

- Install `better-auth` package
- Create `src/lib/auth.ts` configuration
- Rewrite `/api/auth/login` and `/api/auth/logout`
- Update `middleware.ts` to use better-auth sessions
- Update login page for better-auth client

### 2.3 Scheduler Optimization

Improve scheduler efficiency:

- Batch DynamoDB queries where possible
- Add early-exit checks when no work exists
- Skip processing for empty result sets

**Files:**

- `src/app/api/events/route.ts` (delete)
- `src/hooks/useSSE.ts` (delete)
- `src/hooks/usePolling.ts` (new)
- `src/lib/auth.ts` (new)
- `src/app/api/auth/*` (rewrite)
- `src/middleware.ts`
- `src/app/login/page.tsx`
- `src/app/interviews/page.tsx`
- `src/app/takehomes/page.tsx`
- `src/lib/scheduler.ts`
- `src/lib/operations.ts`

---

## Phase 3: Infrastructure

**Goal:** Improve observability and ensure adequate resources.

### 3.1 Logging Pattern Refinement

Standardize logging across the application:

**Requirements:**

- Unified logger with consistent format (timestamp, level, context, message)
- Structured JSON for CloudWatch Logs Insights queries
- Request ID/correlation ID for tracing
- Domain-specific loggers: `authLogger`, `operationsLogger`, `terraformLogger`
- Never log sensitive data (passcodes, tokens)

**Instrumentation areas:**

- Auth flow
- API route handlers
- Scheduler operations
- Terraform operations

### 3.2 ECS Container Insights

Enable CloudWatch Container Insights:

- CPU/memory per task and service
- Network I/O metrics
- Automatic dashboards

**Terraform:** Add `containerInsights = "enabled"` to ECS cluster.

### 3.3 Production Instance Sizing

Increase ECS task resources for production:

- Review current CPU/memory allocation
- Increase based on observed usage patterns
- Separate variables for dev vs prod sizing

### 3.4 CloudWatch Configuration

- Set log retention (e.g., 30 days)
- Add metric filters for error patterns
- Create alarms for critical error thresholds

**Files:**

- `src/lib/logger.ts` (enhance)
- All files using logging (standardize)
- `infra/modules/compute/main.tf`
- `infra/modules/compute/variables.tf`

---

## Phase Dependencies

```
Phase 1 (security) → Phase 2 (simplification) → Phase 3 (infrastructure)
```

- Phase 1 is independent, addresses security first
- Phase 2 requires stable Next.js before major refactors
- Phase 3 benefits from simplified architecture in Phase 2

## Risk Considerations

| Risk                        | Mitigation                                          |
| --------------------------- | --------------------------------------------------- |
| Next.js 16 breaking changes | Review migration guide, test thoroughly             |
| better-auth learning curve  | Simple passcode config minimizes complexity         |
| Polling performance         | GSI queries (activeOnly=true) minimize DynamoDB cost |
| Migration downtime          | Deploy each phase independently, rollback if needed |
