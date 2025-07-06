# Contributing to Prequel

This guide is for developers contributing code to the Prequel project. It covers local development setup, testing, code quality, and submission guidelines.

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
   ```

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
- Hook tests: `src/hooks/__tests__/`
- API tests: `src/app/api/**/__tests__/`
- Page tests: `src/app/__tests__/`

**E2E Tests:** `e2e/*.spec.ts`
- User workflows: `e2e/portal.spec.ts`

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
- Follow existing code patterns and conventions
- Use existing libraries and utilities
- Check neighboring files for style consistency
- Never assume library availability - check package.json first

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

### Development
1. **Test locally first** - Don't rely on CI for testing
2. **Use watch modes** - `npm run test:dev` during development
3. **Quick feedback** - Run `test:quick` frequently
4. **Write tests** - Add tests for new functionality
5. **Follow conventions** - Match existing code style

### Testing
1. **Local-first approach** - All tests should run locally
2. **Fast feedback** - Use watch modes and focused tests
3. **Interactive debugging** - Use UI tools for E2E debugging
4. **Mock external services** - Keep tests fast and reliable
5. **Test user workflows** - E2E tests should test real challenges

### Code Quality
1. **Automatic formatting** - Let Prettier handle formatting
2. **Strict typing** - Use TypeScript strictly
3. **Consistent patterns** - Follow existing code conventions
4. **Clear naming** - Use descriptive variable and function names
5. **Security first** - Never commit secrets or credentials

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