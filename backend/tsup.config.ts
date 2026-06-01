import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  // Bundle only our own src/ (this resolves the extensionless relative imports
  // carried over from the Next.js codebase). Everything in node_modules — AWS
  // SDK, hono, jszip — is externalized and resolved at runtime from the
  // installed prod dependencies, so dynamic requires inside those packages keep
  // working and the bundle stays small.
  skipNodeModulesBundle: true,
})
