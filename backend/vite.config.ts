import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__mocks__/**', 'src/**/*.d.ts'],
      thresholds: { lines: 20, statements: 20, functions: 20, branches: 20 },
    },
  },
  lint: {
    plugins: ['typescript'],
    categories: { correctness: 'error' },
    rules: { 'no-unused-vars': 'error' },
    ignorePatterns: ['dist', 'node_modules', 'coverage'],
  },
  fmt: {
    semi: false,
    singleQuote: true,
    ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  staged: {
    '*.{ts,js,json}': 'vp check --fix',
  },
})
