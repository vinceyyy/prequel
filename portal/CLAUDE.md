# Portal CLAUDE.md

This file provides detailed guidance for AI developers (Claude) working on the Prequel Portal NextJS application with real-time polling, scheduling, and background operations.

## Project Overview

The portal is a NextJS 16 application that provides a real-time web interface for managing coding interviews. It features 1-second polling for live updates, interview scheduling with auto-destroy, background operations management, and AWS infrastructure integration.

## Architecture Details

### Core Technologies

- **Framework**: Next.js 16 with App Router (not Pages Router)
- **Language**: TypeScript with strict type checking enabled
- **Styling**: Tailwind CSS (utility-first approach)
- **Real-time**: 1-second polling via custom React hooks
- **State Management**: React hooks + polling (no Redux/Zustand)
- **Testing**: Jest + React Testing Library + Playwright E2E
- **Code Quality**: ESLint + Prettier (enforced strictly)
- **Authentication**: HMAC-signed session tokens (30-day expiry)

### Directory Structure and Responsibilities

```
portal/src/
├── app/                           # Next.js App Router
│   ├── api/                      # API routes (server-side)
│   │   ├── auth/                 # Authentication endpoints
│   │   │   ├── login/route.ts    # Login with passcode
│   │   │   └── logout/route.ts   # Logout
│   │   ├── interviews/           # Interview CRUD operations
│   │   │   ├── create/route.ts   # Creates interviews + operations
│   │   │   ├── route.ts          # Lists interviews (merges with operations)
│   │   │   └── [id]/destroy/route.ts # Destroys interviews
│   │   ├── operations/           # Background operation management
│   │   │   ├── route.ts          # Lists all operations
│   │   │   └── [id]/             # Individual operation management
│   │   ├── takehomes/            # Take-home assessment management
│   │   └── challenges/route.ts   # S3-based challenge listing
│   ├── interviews/page.tsx       # Interview management UI
│   ├── takehomes/page.tsx        # Take-home management UI
│   ├── challenges/page.tsx       # Challenge management UI
│   ├── layout.tsx                # Root layout with auth
│   └── globals.css               # Global Tailwind styles
├── components/                    # Reusable React components
│   ├── OperationDashboard.tsx    # Operation logs viewer
│   └── __tests__/                # Component unit tests
├── hooks/                        # Custom React hooks
│   ├── usePolling.ts             # Polling hooks for real-time updates
│   ├── useOperations.ts          # Background operations management
│   └── __tests__/                # Hook unit tests
└── lib/                          # Core business logic (server-side)
    ├── config.ts                 # Centralized configuration system
    ├── auth.ts                   # Session token management
    ├── operations.ts             # Operation management (DynamoDB)
    ├── scheduler.ts              # Background scheduler service
    ├── terraform.ts              # AWS infrastructure management
    ├── interviews.ts             # DynamoDB interview management
    ├── assessments.ts            # Take-home assessment management
    └── fileExtraction.ts         # File saving and extraction
```

### Key System Components

#### 1. Polling System (`src/hooks/usePolling.ts`)

**Purpose**: Real-time updates via 1-second polling.

**Available Hooks**:

```typescript
// Poll interviews directly - server merges operation status
const {
  interviews, // InterviewData[] - all active interviews
  hasInProgressInterviews, // boolean - any initializing/configuring/destroying
  lastUpdated, // Date | null - last successful fetch
  isLoading, // boolean - true only on initial load
  error, // string | null
  refresh, // () => Promise<void>
} = useInterviewPolling()

// Poll take-homes directly
const {
  takeHomes,
  hasInProgressTakeHomes,
  lastUpdated,
  isLoading,
  error,
  refresh,
} = useTakeHomePolling()

// Poll operations for toast notifications
const { lastOperation } = useOperationPolling({
  filterPrefix: 'INTERVIEW#', // or 'TAKEHOME#'
})
```

**Key Design Decisions**:

- **State-based polling**: Polls `/api/interviews` or `/api/takehomes` directly
- **Server-side merging**: Server handles operation-to-status mapping
- **No client-side status mapping**: Eliminates duplicated logic
- **1-second fixed interval**: Simple, low latency, negligible cost
- **Initial load only**: `isLoading` only true on first fetch to prevent flickering

#### 2. Centralized Configuration (`src/lib/config.ts`)

**Purpose**: Type-safe, centralized management of all environment variables.

```typescript
import { config } from '@/lib/config'

// AWS configuration with automatic credential handling
config.aws.getCredentials() // Returns appropriate credentials for context
config.aws.region // AWS region
config.aws.deploymentContext // 'ecs' | 'local'

// Auto-generated resource names
config.database.interviewsTable // {prefix}-{env}-interviews
config.database.operationsTable // {prefix}-{env}-operations
config.storage.challengeBucket // {prefix}-challenge
config.storage.historyBucket // {prefix}-{env}-history
```

#### 3. Authentication (`src/lib/auth.ts`)

**Purpose**: Secure session management with HMAC-signed tokens.

- **Session duration**: 30 days
- **Token format**: `timestamp.signature`
- **Signing key**: Derived from AUTH_PASSCODE + AUTH_SECRET
- **Cookie settings**: httpOnly, secure (in production), sameSite=strict

#### 4. Operations Manager (`src/lib/operations.ts`)

**Purpose**: Track long-running background tasks in DynamoDB.

- **Operation types**: `create` | `destroy`
- **Operation statuses**: `pending` | `running` | `completed` | `failed` | `cancelled` | `scheduled`
- **Storage**: DynamoDB with GSI for efficient status queries
- **Used for**: Background provisioning, scheduling, auto-destroy, logs

#### 5. Scheduler Service (`src/lib/scheduler.ts`)

**Purpose**: Process scheduled operations and auto-destroy timeouts.

- **30-second polling interval**: Checks for operations to process
- **Pre-provisioning**: Starts 5 minutes before scheduled time
- **Auto-destroy**: Processes operations with `autoDestroyAt` <= now
- **Server-side only**: Runs within NextJS server process

## Development Guidelines

### Data Fetching Pattern

**IMPORTANT**: Use state-based polling, not operations-based.

```typescript
// CORRECT: Poll state directly
const { interviews } = useInterviewPolling()

// The server handles everything:
// 1. Gets interviews from DynamoDB
// 2. Gets active operations
// 3. Maps operation status → interview status
// 4. Returns merged, deduplicated list

// INCORRECT: Don't poll operations and map status client-side
// This duplicates server logic and adds complexity
```

See `docs/data-fetching.md` for detailed architecture documentation.

### React Patterns

```typescript
// Good: Use polling hooks for real-time data
const InterviewsPage = () => {
  const { interviews, hasInProgressInterviews } = useInterviewPolling()
  const { lastOperation } = useOperationPolling({ filterPrefix: 'INTERVIEW#' })

  // Toast notifications on operation completion
  useEffect(() => {
    if (lastOperation?.status === 'completed') {
      showToast(`Interview ready for ${lastOperation.candidateName}`)
    }
  }, [lastOperation])

  return <InterviewList interviews={interviews} />
}
```

### API Route Patterns

```typescript
// Background operation with proper error handling
export async function POST(request: NextRequest) {
  const operationId = await operationManager.createOperation({
    type: 'create',
    interviewId,
    candidateName,
    // ...
  })

  // Start background work
  setImmediate(async () => {
    try {
      await operationManager.updateStatus(operationId, 'running')
      const result = await terraformManager.createInterview(instance)
      await operationManager.setResult(operationId, result)
    } catch (error) {
      await operationManager.setResult(operationId, {
        success: false,
        error: error.message,
      })
    }
  })

  return NextResponse.json({ operationId, interviewId })
}
```

### Testing Requirements

- **Unit tests**: Focus on business logic, mock AWS services
- **E2E tests**: Use Playwright for full user flows
- **Run before commit**: `npm run test:quick`
- **Run before PR**: `npm run test:all`

### Error Handling

```typescript
// Consistent API error format
return NextResponse.json(
  {
    error: 'User-friendly error message',
    details:
      process.env.NODE_ENV === 'development' ? technicalDetails : undefined,
  },
  { status: 400 }
)
```

## Security Considerations

### Authentication

- **Passcode-based**: Simple but secure for internal tools
- **HMAC-signed tokens**: Prevents tampering
- **30-day sessions**: Balance between security and convenience
- **Changing passcode**: Invalidates all existing sessions

### AWS Authentication

- **Local development**: AWS SSO via `AWS_PROFILE`
- **ECS deployment**: IAM task roles (automatic)
- **Never commit credentials**: Use environment variables

## Performance Considerations

### Polling Efficiency

- **1-second interval**: ~$0.16/month per user (negligible)
- **No flickering**: Loading state only on initial fetch
- **Server-side merging**: Reduces client complexity
- **GSI queries**: Efficient DynamoDB lookups by status

### Background Processing

- **Non-blocking**: Use `setImmediate` for long-running tasks
- **Timeout handling**: Reasonable timeouts for AWS operations
- **Resource cleanup**: Proper cleanup on failures

## Debugging

### Common Issues

1. **Interviews not updating**: Check browser Network tab for polling requests
2. **Operation stuck**: Check operation logs via Logs button
3. **Build errors**: Run `npx tsc --noEmit` for type errors
4. **Test failures**: Use `test.only()` to isolate failing tests

### Useful Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run test:quick   # Quick pre-commit tests
npm run test:all     # Full test suite
```
