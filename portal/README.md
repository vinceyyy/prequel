# Prequel Portal

The web interface for managing coding interviews and VS Code instances.

## Quick Start

### Development Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure AWS (required for full functionality):**

   ```bash
   aws configure sso --profile your-aws-profile
   aws sso login --profile your-aws-profile
   export AWS_PROFILE=your-aws-profile
   ```

3. **Setup environment:**

   ```bash
   cp .env.example .env.local
   # .env.local is pre-configured for development
   ```

4. **Start development:**
   ```bash
   npm run dev          # Development server at http://localhost:3000
   npm run test:dev     # Watch mode testing (recommended for TDD)
   ```

## Available Scripts

### Development

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint code quality checks
npm run format       # Fix code formatting with Prettier
npm run format:check # Check code formatting without fixing
```

### Testing (Local Focus)

```bash
# Quick validation (recommended before commits)
npm run test:quick   # Fast tests: format, lint, unit tests, build (2-3 min)

# Full test suite (before creating PRs)
npm run test:all     # Complete suite: all tests + E2E (5-10 min)

# Development workflow
npm run test:dev     # Watch mode - auto-runs tests when files change

# Individual test types
npm run test         # Unit tests only
npm run test:watch   # Unit tests in watch mode
npm run test:coverage # Unit tests with coverage report
npm run test:e2e     # End-to-end tests (headless)
npm run test:e2e:ui  # E2E tests with interactive UI (debugging)
npm run test:e2e:headed # E2E tests with visible browser
```

### Helper Scripts

```bash
./scripts/test-quick.sh      # Same as npm run test:quick
./scripts/test-all.sh        # Same as npm run test:all
./scripts/test-watch.sh      # Same as npm run test:dev
./scripts/setup-git-hooks.sh # Setup automatic pre-commit testing
```

## Testing Strategy

### Local-First Approach

All testing is designed to run locally for fast feedback:

- **Unit Tests**: Jest + React Testing Library
- **E2E Tests**: Playwright with browser automation
- **Integration Tests**: API route testing with mocks
- **Code Quality**: ESLint + Prettier

### Recommended Workflow

**During Active Development:**

```bash
# Terminal 1: Development server
npm run dev

# Terminal 2: Continuous testing
npm run test:dev
```

**Before Each Commit:**

```bash
npm run test:quick   # 2-3 minutes validation
```

**Before Creating PR:**

```bash
npm run test:all     # 5-10 minutes full confidence check
```

### Debugging Tests

**Unit Tests:**

- Use `test.only()` to focus on specific tests
- Add `console.log()` for debugging
- Check `coverage/` directory for coverage reports

**E2E Tests:**

- Use `npm run test:e2e:ui` for interactive debugging
- Use `await page.pause()` to pause execution
- Run `npm run test:e2e:headed` to see browser actions

## Architecture

### Tech Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS
- **Language**: TypeScript
- **Testing**: Jest, React Testing Library, Playwright
- **Code Quality**: ESLint, Prettier

### Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── api/            # API routes
│   ├── __tests__/      # Page component tests
│   └── globals.css     # Global styles
├── components/         # Reusable React components
│   └── __tests__/      # Component tests
├── hooks/              # Custom React hooks
│   └── __tests__/      # Hook tests
└── lib/                # Utility functions and services

e2e/                    # End-to-end tests
scripts/                # Helper scripts for testing
coverage/               # Test coverage reports (generated)
playwright-report/      # E2E test reports (generated)
```

### Key Features

- **Interview Management**: Create, monitor, and destroy coding interview instances
- **Real-time Updates**: Live status updates and operation monitoring
- **AWS Integration**: Automated infrastructure provisioning via Terraform
- **Security**: Password-protected access with temporary credentials

## Configuration

### Environment Variables

- `.env.example` - Template with all required variables
- `.env.local` - Local development configuration (auto-created)
- Production uses ECS task role authentication (no env vars needed)

### AWS Requirements

- ECS cluster for running interview instances
- Application Load Balancer for routing
- Route53 for DNS management
- IAM roles with appropriate permissions

## Production Deployment

The portal is designed to run on AWS ECS:

1. **Build Docker image:**

   ```bash
   docker build -t prequel-portal .
   ```

2. **Deploy to ECS** with:
   - Task role with ECS, ELB, Route53 permissions
   - Environment: `NODE_ENV=production`
   - No AWS_PROFILE needed (uses ECS metadata service)

## Troubleshooting

### Common Issues

**Tests failing locally:**

- Run `npm install` to ensure dependencies are installed
- For E2E tests: `npx playwright install` to install browsers
- Check `portal/TESTING.md` for detailed debugging guide

**AWS authentication errors:**

- Run `aws sso login --profile your-aws-profile`
- Set `export AWS_PROFILE=your-aws-profile`
- Restart development server after authentication

**Build failures:**

- Run `npm run format` to fix formatting issues
- Run `npm run lint` to identify code quality issues
- Check TypeScript errors in IDE or build output

### Getting Help

1. Check `TESTING.md` for detailed testing guidance
2. Review `../CLAUDE.md` for development workflow
3. Check CloudWatch logs for production issues
4. Use `npm run test:e2e:ui` for interactive E2E debugging

## Contributing

1. Run `npm run test:quick` before every commit
2. Run `npm run test:all` before creating PRs
3. Follow the existing code style (enforced by Prettier)
4. Add tests for new features
5. Update documentation as needed

The project emphasizes local testing over CI/CD for faster development feedback.
