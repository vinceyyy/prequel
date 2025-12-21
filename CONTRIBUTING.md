# Contributing to Prequel

This guide is for developers contributing code to the Prequel project with real-time SSE features. It covers local development setup, testing, code quality, and submission guidelines for the scheduling and live-update system.

## 🚀 Quick Start for Contributors

### Prerequisites
- Node.js (>= 18)
- AWS CLI configured with SSO profile `<AWS_PROFILE>`
- Git

### Setup Development Environment

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd prequel/portal
   npm install
   ```

2. **Configure AWS:**
   ```bash
   aws configure sso --profile <AWS_PROFILE>
   aws sso login --profile <AWS_PROFILE>
   export AWS_PROFILE=<AWS_PROFILE>
   ```

3. **Setup environment:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration:
   # AWS_PROFILE=your-aws-sso-profile
   # PROJECT_PREFIX=your-project-prefix  # Must match deployed infrastructure
   # ENVIRONMENT=dev                     # Must match deployed infrastructure
   ```

   **⚠️ Important**: The portal uses a **centralized configuration system** (`src/lib/config.ts`) that auto-generates AWS resource names. Your local environment must match your deployed infrastructure for the portal to connect to the correct DynamoDB tables and S3 buckets.

4. **Start development:**
   ```bash
   npm run dev          # Development server at http://localhost:3000
   npm run test:dev     # Continuous testing (recommended)
   ```

## 📋 Development Workflow

### Daily Development
```bash
# Terminal 1: Development server
npm run dev

# Terminal 2: Continuous testing
npm run test:dev
```

### Before Every Commit
```bash
cd portal/
npm run test:quick   # ⚡ 2-3 minutes: format, lint, unit tests, build
```

### Before Creating Pull Requests
```bash
npm run test:all     # 🧪 5-10 minutes: complete test suite + E2E
```

## 🧪 Testing Guidelines

### Test Philosophy
- **Local-first testing** - All tests run locally for fast feedback
- **No waiting for CI** - Get immediate results on your machine
- **Interactive debugging** - Use UI tools to debug failing tests

### Essential Test Commands

```bash
# Quick validation (recommended before commits)
npm run test:quick   # Format, lint, unit tests, build check

# Complete test suite (before PRs)
npm run test:all     # Everything + E2E tests

# Development testing
npm run test:dev     # Watch mode - auto-runs tests when files change
npm run test:watch   # Unit tests in watch mode only

# Individual test types
npm run test         # Unit tests only
npm run test:e2e     # E2E tests only
npm run test:e2e:ui  # Interactive E2E debugging
npm run test:coverage # Unit tests with coverage report
```

### Test Types & Locations

**Unit Tests:** `src/**/*.test.{ts,tsx}`
- Component tests: `src/components/__tests__/`
- Hook tests: `src/hooks/__tests__/` (includes `useSSE`, `useOperations`)
- API tests: `src/app/api/**/__tests__/` (includes SSE events, scheduling)
- Page tests: `src/app/__tests__/`

**E2E Tests:** `e2e/*.spec.ts`
- User workflows: `e2e/portal.spec.ts` (includes scheduling and real-time features)

**Real-time Feature Testing:**
- SSE connections require manual testing in development environment
- EventSource API not available in Node.js test environment
- Background operations tested via operation manager unit tests

### Writing Tests

**Unit Tests:**
- Use descriptive names: `it('should display error message when API fails')`
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies
- Test behavior, not implementation details

**E2E Tests:**
- Test complete user workflows
- Use page object pattern for complex interactions
- Mock API responses when needed
- Keep tests fast and reliable

### Debugging Tests

**Unit Tests:**
- Use `test.only()` to focus on specific tests
- Add `console.log()` for debugging
- Check coverage with `npm run test:coverage`

**E2E Tests:**
- Use `npm run test:e2e:ui` for interactive debugging
- Use `npm run test:e2e:headed` to see browser actions
- Add `await page.pause()` to pause execution

## 📝 Code Quality Standards

### Formatting & Linting
```bash
npm run format       # Auto-fix code formatting with Prettier
npm run format:check # Check formatting without fixing
npm run lint         # Run ESLint code quality checks
```

### Code Style Guidelines
- **Prettier**: Automatic formatting (single quotes, no semicolons, 80 char width)
- **ESLint**: TypeScript and Next.js rules enforced
- **Tailwind CSS**: Use utility classes instead of inline styles
- **TypeScript**: Strict type checking enabled

### Architecture Guidelines

**General Development Guidelines**
Follow existing code patterns and conventions throughout the codebase. Use existing libraries and utilities rather than introducing new dependencies. Check neighboring files for style consistency and never assume library availability without checking package.json first.

**Real-time Architecture Requirements**
Use `operationManager.emit()` for all operation status changes to ensure SSE events are properly triggered. All long-running tasks must use the background operations system, while time-based execution should be scheduled via `SchedulerService`. UI updates must be driven by SSE events only - avoid manual polling patterns. Always implement auto-destroy functionality to prevent resource waste.

**Centralized Configuration System**
The portal uses `src/lib/config.ts` for type-safe, centralized management of all environment variables and AWS resource configuration. This system automatically detects local vs ECS deployment contexts and uses appropriate AWS credentials (SSO for local development, IAM task roles for ECS). It auto-generates consistent AWS resource names from PROJECT_PREFIX and ENVIRONMENT, and provides complete TypeScript interfaces for all configuration values.

**Key Architecture Components**
The system relies on several core components: `src/lib/operations.ts` handles operation management with SSE event emission, `src/lib/scheduler.ts` provides background scheduler service with 30-second polling, `src/app/api/events/route.ts` serves as the SSE endpoint for real-time updates, `src/hooks/useSSE.ts` manages client-side SSE connections with auto-reconnection, and `src/hooks/useOperations.ts` provides background operation management hooks.

## 🔧 Commit Guidelines

### Commit Message Format
Use conventional commits:
```
feat: add interview creation form validation
fix: resolve Terraform AWS provider permission error
docs: update contributing guidelines
test: add E2E tests for interview workflow
```

### Pre-commit Checklist
1. ✅ Run `npm run test:quick` (must pass)
2. ✅ Ensure all tests pass locally
3. ✅ Check that build succeeds: `npm run build`
4. ✅ Verify code follows style guidelines
5. ✅ Write/update tests for new functionality

### Optional: Automated Pre-commit Testing
```bash
./scripts/setup-git-hooks.sh  # Setup automatic testing on commit
```

## 📦 Pull Request Process

### Before Creating PR
1. **Full test suite:** `npm run test:all`
2. **Update documentation** if needed
3. **Test manually** in development environment
4. **Rebase** on latest main branch

### PR Requirements
- All tests must pass locally
- Code must follow project style guidelines
- Include tests for new functionality
- Update documentation as needed
- Descriptive PR title and description

### PR Review Process
- Automated CI checks (formatting, linting, build)
- Manual code review by maintainers
- Local testing by reviewers if needed

## 🛠️ Helper Scripts

### Available Scripts
```bash
./scripts/test-quick.sh      # Same as npm run test:quick
./scripts/test-all.sh        # Same as npm run test:all
./scripts/test-watch.sh      # Same as npm run test:dev
./scripts/setup-git-hooks.sh # Setup automatic pre-commit testing
```

## ⚡ Testing Real-time Features

### Manual Testing Checklist

Since SSE and scheduling features require browser APIs not available in Node test environment, manual testing is essential:

**SSE Connection Testing:**
```bash
# Start development server
npm run dev

# In browser DevTools > Network tab:
# 1. Look for /api/events connection with "event-stream" type
# 2. Should show persistent connection with periodic heartbeat events
# 3. Check connection indicator shows "Live updates" (green dot)
```

**Scheduling Feature Testing:**
```bash
# Test scheduled interview creation:
# 1. Create interview with future scheduled time (1-2 minutes ahead)
# 2. Verify interview shows "scheduled" status with correct times
# 3. Wait for scheduled time - should automatically start
# 4. Monitor real-time status updates via SSE
# 5. Verify auto-destroy countdown displays correctly
```

**Background Operations Testing:**
```bash
# Test real-time operation updates:
# 1. Create interview (immediate or scheduled)
# 2. Open browser DevTools > Network > event-stream connections
# 3. Watch for operation_update events as status changes
# 4. Verify UI updates instantly without manual refresh
# 5. Check operation logs update in real-time
```

**Auto-destroy Testing:**
```bash
# Test mandatory auto-destroy:
# 1. Create interview with short duration (30 minutes)
# 2. Verify autoDestroyAt time is calculated and displayed correctly
# 3. Check that auto-destroy cannot be disabled
# 4. Monitor scheduled destruction in operation logs
```

### Real-time Development Workflow

When working on SSE or scheduling features:

1. **Start with unit tests** for operation manager logic
2. **Use manual testing** for SSE connection verification
3. **Test edge cases** like connection loss and reconnection
4. **Verify timing** for scheduled operations and auto-destroy
5. **Check browser compatibility** for EventSource support

## 🐛 Troubleshooting

### Common Development Issues

**Tests failing locally:**
- Run `npm install` to ensure dependencies are installed
- For E2E tests: `npx playwright install` to install browsers
- Check Jest configuration in `jest.config.js`

**AWS authentication errors:**
- Run `aws sso login --profile <AWS_PROFILE>`
- Set `export AWS_PROFILE=<AWS_PROFILE>`
- Restart development server after authentication

**Build failures:**
- Run `npm run format` to fix formatting issues
- Run `npm run lint` to identify code quality issues
- Check TypeScript errors in IDE or build output

**Module resolution errors:**
- Ensure `@/` alias is used correctly in imports
- Check `moduleNameMapping` in `jest.config.js`
- Verify TypeScript paths in `tsconfig.json`

### Performance Tips
- Use `test:quick` for regular development
- Use `test:watch` for TDD workflow  
- Only run `test:all` before important commits/PRs
- Use `test.only()` to focus on specific failing tests

## 📋 CI/CD Integration

### GitHub Actions
The CI pipeline runs lightweight checks:
- Code formatting validation
- ESLint code quality checks
- TypeScript compilation
- Production build verification
- Terraform configuration validation

**Important:** Full testing (including E2E tests) is expected to be done locally before pushing.

### Infrastructure Changes
```bash
cd infra/
terraform plan   # Preview changes
terraform apply  # Deploy changes (production)
```

### Template Updates
```bash
cd instance/
./sync-to-s3.sh  # Update Terraform templates

cd challange/
./sync-to-s3.sh  # Update interview challenges
```

## 🎯 Best Practices

### Development Best Practices
Test locally first rather than relying on CI for testing feedback. Use watch modes like `npm run test:dev` during development for continuous feedback. Run `test:quick` frequently for rapid validation. Always add tests for new functionality and follow existing code conventions throughout the codebase.

### Testing Philosophy
Embrace a local-first approach where all tests run locally for immediate feedback. Use watch modes and focused tests for fast development cycles. Leverage interactive debugging tools like UI interfaces for E2E debugging. Mock external services to keep tests fast and reliable, while ensuring E2E tests cover real user workflows and challenges.

### Code Quality Standards
Let Prettier handle automatic formatting to maintain consistency. Use TypeScript strictly with proper type definitions throughout. Follow consistent patterns that match existing code conventions. Use descriptive variable and function names for clarity. Always prioritize security by never committing secrets or credentials to the repository.

## 📖 Additional Resources

- **Architecture Overview:** See project README.md
- **API Documentation:** Check `src/app/api/` for route implementations
- **Component Library:** Review `src/components/` for reusable components
- **Deployment Guide:** See `infra/` directory for infrastructure details

## 🤝 Getting Help

1. Check this contributing guide first
2. Review existing tests for examples
3. Use `npm run test:e2e:ui` for interactive E2E debugging
4. Check issue tracker for known problems
5. Ask questions in pull request discussions

Remember: The goal is fast, local development with comprehensive testing before code submission.