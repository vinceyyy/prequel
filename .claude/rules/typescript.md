---
alwaysApply: true
---

# TypeScript Rules

## Tooling

- **Toolchain**: Vite+ (`vp`) — unified CLI for dev server, builds, linting, formatting, testing, and package management
- **Linting/Formatting**: Oxlint + Oxfmt (included in Vite+, replaces ESLint + Prettier + Biome)
- **Testing**: Vitest (unit, included in Vite+), Playwright (E2E)
- **Type checking**: `vp check` runs formatting, linting, and type checking in one command
- **Package manager**: `vp install` / `vp add` (built into Vite+)
- **Config**: `vite.config.ts` using `defineConfig` from `vite-plus`
- **Docs**: Vite+ is new — always use Context7 MCP to fetch current docs before using `vp` commands or configuring `vite-plus`

## UI & Styling

- **UI Library**: shadcn/ui (Radix primitives)
- **Icons**: Lucide (`lucide-react`)
- **Styling**: Tailwind CSS v4
- **Class composition**: `cn()` utility (clsx + tailwind-merge)

## React Patterns

- **State**: Local component state + custom polling hooks. No Zustand/SWR — the
  real-time UI is driven by 1-second polling hooks in `frontend/src/hooks`.
- **Hooks**: Extract reusable logic into custom hooks (`useInterviewPolling`, `useOperationPolling`)
- **Routing**: React Router (`react-router-dom`); routes defined in `frontend/src/App.tsx`

## Project Structure

- **Workspace**: pnpm monorepo — `frontend/` (Vite React SPA) + `backend/` (Hono API).
  The backend serves the built SPA from `./public` in production; dev uses a Vite proxy
  (`/api` → `:3000`).
- **Backend build**: bundled with `tsup` (esbuild) to `dist/`, since the ported `lib/`
  uses extensionless relative imports. Deps are externalized, resolved at runtime.
- **Path aliases**: `@/` maps to each package's `src/`
- **File naming**: PascalCase for components, camelCase for utilities
- **Organization**: Group by feature/domain, not file type
