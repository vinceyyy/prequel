import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: proxy API + health to the Hono backend so the SPA is same-origin.
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      thresholds: { lines: 5, statements: 5, functions: 5, branches: 5 },
    },
  },
  lint: {
    plugins: ['typescript', 'react'],
    rules: { 'no-unused-vars': 'error' },
    ignorePatterns: ['dist', 'node_modules', 'coverage'],
  },
  fmt: {
    semi: false,
    singleQuote: true,
    ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  staged: {
    '*.{ts,tsx,js,jsx,css,json,html}': 'vp check --fix',
  },
})
