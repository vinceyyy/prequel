# Local Testing Guide

This guide covers testing for the Prequel Portal project, including real-time polling features and background operations.

## 🚀 Quick Reference

```bash
# Essential commands for daily development
npm run test:quick   # ⚡ Fast pre-commit validation (2-3 min)
npm run test:dev     # 👀 Watch mode during development
npm run test:all     # 🧪 Complete test suite for PRs (5-10 min)

# Individual test types
npm run test         # Unit tests only
npm run test:e2e     # E2E tests only
npm run test:e2e:ui  # Interactive E2E debugging

# Code quality
npm run format       # Fix formatting
npm run lint         # Check code quality
npm run build        # Verify build works
```

## Quick Start

### 🚀 Pre-commit Testing (Recommended)

Run this before every commit to ensure everything works:

```bash
npm run test:quick
```

### 🧪 Full Test Suite

Run the complete test suite (takes longer):

```bash
npm run test:all
```

### 👀 Development Mode

Watch for file changes and re-run tests automatically:

```bash
npm run test:dev
```

## Individual Test Commands

### Unit Tests

```bash
# Run all unit tests once
npm run test

# Watch mode - re-runs when files change
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### End-to-End Tests

```bash
# Run E2E tests headless (faster)
npm run test:e2e

# Run E2E tests with browser UI (slower, good for debugging)
npm run test:e2e:headed

# Interactive Playwright UI (best for writing/debugging tests)
npm run test:e2e:ui
```

### Code Quality

```bash
# Check code formatting
npm run format:check

# Fix code formatting
npm run format

# Run linter
npm run lint

# Build check
npm run build
```

## Testing Real-time Features

### Polling-Based Updates

The portal uses 1-second polling for real-time updates. This approach works in all environments and is straightforward to test.

**Testing Approach:**

```bash
# Start development server
npm run dev

# In browser, open DevTools > Network tab
# Look for /api/interviews or /api/takehomes requests every 1 second
# Should see 200 responses with updated interview data
```

**Manual Testing Checklist:**

- [ ] Status indicator shows "Active" when interviews are in progress
- [ ] Creating interview appears in list within 1 second
- [ ] Scheduling interview shows correct scheduled time
- [ ] Status changes (initializing → configuring → active) update within 1 second
- [ ] Auto-destroy countdown displays correctly
- [ ] Toast notifications appear when operations complete

### Enhanced Challenge Management

**File Upload Testing:**

```bash
# Test drag-and-drop functionality
# 1. Navigate to Challenges page
# 2. Create new challenge
# 3. Test folder upload (try .vscode folder)
# 4. Test mixed file/folder uploads
# 5. Verify folder structure preserved in S3
```

**Manual Testing Checklist:**

- [ ] Drag-and-drop accepts both files and folders
- [ ] Folder structure preserved (check webkitRelativePath)
- [ ] Upload progress indicators work correctly
- [ ] Project structure guidelines displayed clearly
- [ ] Error messages shown for failed uploads
- [ ] Challenge deletion works and removes S3 files
- [ ] Resource configurations (CPU/memory) display correctly

### File History Management

**Download Testing:**

```bash
# Test file saving and downloading
# 1. Create interview with saveFiles enabled
# 2. Let interview reach active state
# 3. Add files to the interview workspace
# 4. Destroy interview with file saving
# 5. Check History tab shows download button
# 6. Test download functionality
```

**Manual Testing Checklist:**

- [ ] Download button shows only when saveFiles=true
- [ ] Download button hidden when saveFiles=false with "History not saved"
- [ ] Download works and returns tar.gz file
- [ ] Error messages displayed when download fails
- [ ] Error messages specific to different failure types:
  - [ ] "Files were not saved for this interview"
  - [ ] "Failed to access saved files"
  - [ ] "Interview not found"

### Background Operations

**Testing scheduled operations:**

```bash
# Create scheduled interview (set time 1-2 minutes in future)
# Check operation logs show "scheduled" status
# Wait for scheduled time - should automatically start
# Monitor real-time status updates via polling
```

**Testing auto-destroy:**

```bash
# Create interview with 30-minute duration
# Verify autoDestroyAt time is displayed correctly
# Check scheduler processes auto-destroy operations
```

### Operation Manager Events

**Key test scenarios:**

- Operation creation updates are visible via polling within 1 second
- Status updates (pending → running → completed) visible via polling
- Operation completion with results triggers toast notification
- Failed operations show error toast and update status

## Test Types & Locations

### Unit Tests (`src/**/*.test.{ts,tsx}`)

- **Component Tests**: `src/components/__tests__/`
- **Hook Tests**: `src/hooks/__tests__/`
- **API Tests**: `src/app/api/**/__tests__/`
- **Page Tests**: `src/app/__tests__/`

### E2E Tests (`e2e/*.spec.ts`)

- **User Workflows**: `e2e/portal.spec.ts`

## Development Workflow

### 1. During Development

```bash
# Start the dev server in one terminal
npm run dev

# Run tests in watch mode in another terminal
npm run test:dev
```

### 2. Before Committing

```bash
# Quick validation (2-3 minutes)
npm run test:quick
```

### 3. Before Creating PR

```bash
# Full test suite (5-10 minutes)
npm run test:all
```

## Debugging Tests

### Unit Test Debugging

1. Use `test.only()` or `describe.only()` to run specific tests
2. Add `console.log()` statements in tests
3. Use VS Code Jest extension for debugging

### E2E Test Debugging

1. Run with `npm run test:e2e:headed` to see browser
2. Use `await page.pause()` to pause execution
3. Run `npm run test:e2e:ui` for interactive debugging

### Common Issues

#### "Module not found" errors

- Check if `moduleNameMapping` is correct in `jest.config.js`
- Ensure imports use `@/` alias correctly

#### E2E tests fail locally

- Install Playwright browsers: `npx playwright install`
- Make sure dev server is running on port 3000

#### Tests timeout

- Increase timeout in `jest.config.js` or `playwright.config.ts`
- Check for infinite loops or polling issues

## Test Coverage

Run coverage report to see which parts of the code need more tests:

```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory. Open `coverage/lcov-report/index.html` in your browser to see detailed coverage.

## Writing New Tests

### Unit Tests

1. Create test file next to the component/function being tested
2. Use descriptive test names: `it('should display error message when API fails')`
3. Follow AAA pattern: Arrange, Act, Assert
4. Mock external dependencies

**Testing File Upload Components:**

```typescript
// Example test for drag-and-drop functionality
test('should handle folder upload with preserved structure', async () => {
  // Test webkitdirectory handling
  // Mock File objects with webkitRelativePath
  // Verify FormData includes both files and filePaths arrays
})
```

**Testing Download Functionality:**

```typescript
// Example test for download button visibility
test('should show download button when saveFiles is true', () => {
  // Render component with interview having saveFiles: true
  // Verify download button is visible
  // Verify "History not saved" is not shown
})
```

### E2E Tests

1. Add new test cases to `e2e/portal.spec.ts`
2. Use page object pattern for complex interactions
3. Mock API responses when needed
4. Test real user workflows, not implementation details

## Performance Tips

- Use `test:quick` for regular development
- Use `test:watch` for TDD workflow
- Only run `test:all` before important commits/PRs
- Use `test.only()` to focus on specific failing tests
- Keep E2E tests fast by mocking external APIs

## CI Integration

The GitHub Actions CI only runs basic validation:

- Code formatting check
- Linting
- Build verification
- Terraform validation

Full testing is expected to be done locally before pushing.
