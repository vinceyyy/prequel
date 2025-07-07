# Portal CLAUDE.md

This file provides detailed guidance for AI developers (Claude) working on the Prequel Portal NextJS application with real-time SSE features, scheduling, and background operations.

## Project Overview

The portal is a NextJS 15 application that provides a real-time web interface for managing coding interviews. It features Server-Sent Events (SSE) for live updates, interview scheduling with auto-destroy, background operations management, and AWS infrastructure integration.

## Architecture Details

### Core Technologies

- **Framework**: Next.js 15 with App Router (not Pages Router)
- **Language**: TypeScript with strict type checking enabled
- **Styling**: Tailwind CSS (utility-first approach)
- **Real-time**: Server-Sent Events (SSE) via EventSource API
- **State Management**: React hooks + SSE events (no Redux/Zustand)
- **Testing**: Jest + React Testing Library + Playwright E2E
- **Code Quality**: ESLint + Prettier (enforced strictly)

### Directory Structure and Responsibilities

```
portal/src/
├── app/                           # Next.js App Router
│   ├── api/                      # API routes (server-side)
│   │   ├── events/route.ts       # SSE endpoint - CRITICAL for real-time
│   │   ├── interviews/           # Interview CRUD operations
│   │   │   ├── create/route.ts   # Creates interviews + operations
│   │   │   ├── route.ts          # Lists interviews from operations + terraform
│   │   │   └── [id]/destroy/route.ts # Destroys interviews
│   │   ├── operations/           # Background operation management
│   │   │   ├── route.ts          # Lists all operations
│   │   │   └── [id]/             # Individual operation management
│   │   └── challenges/route.ts   # S3-based challenge listing
│   ├── page.tsx                  # Main UI with SSE integration
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global Tailwind styles
├── components/                    # Reusable React components
│   ├── OperationDashboard.tsx    # Real-time operation logs viewer
│   └── __tests__/                # Component unit tests
├── hooks/                        # Custom React hooks
│   ├── useSSE.ts                 # SSE connection with auto-reconnection
│   ├── useOperations.ts          # Background operations management
│   └── __tests__/                # Hook unit tests
└── lib/                          # Core business logic (server-side)
    ├── operations.ts             # Operation management + SSE event emission
    ├── scheduler.ts              # Background scheduler service
    ├── terraform.ts              # AWS infrastructure management
    └── __mocks__/                # Test mocks for Jest
```

### Key System Components

#### 1. Operations Manager (`src/lib/operations.ts`)

**Purpose**: Central system for tracking all long-running background operations with SSE event emission.

**Critical Implementation Details**:

- **ALWAYS emit SSE events** on operation status changes via `emit()` method
- **Persistent storage** in `/tmp/prequel-operations.json` for server restarts
- **Event-driven architecture** - all status changes trigger SSE events immediately
- **Operation types**: `create` | `destroy`
- **Operation statuses**: `pending` | `running` | `completed` | `failed` | `cancelled` | `scheduled`

**Key Methods**:

```typescript
// ALWAYS call emit() after status changes
updateOperationStatus(operationId: string, status: Operation['status']) {
  const operation = this.operations.get(operationId)
  if (operation) {
    operation.status = status
    if (status === 'completed' || status === 'failed') {
      operation.completedAt = new Date()
    }
    this.saveToDisk()
    this.emit(operation)  // CRITICAL: Must emit SSE event
  }
}
```

#### 2. Scheduler Service (`src/lib/scheduler.ts`)

**Purpose**: Background service that processes scheduled operations and auto-destroy timeouts.

**Critical Implementation Details**:

- **30-second polling interval** - processes scheduled operations every 30 seconds
- **Event emission** - emits scheduler events for SSE clients
- **Auto-destroy processing** - handles mandatory resource cleanup
- **Runs only on server-side** - not in browser environment

**Key Responsibilities**:

- Process operations with `scheduledAt` <= current time
- Process operations with `autoDestroyAt` <= current time
- Emit scheduler events for SSE clients
- Handle both interview creation and destruction scheduling

#### 3. SSE Event System (`src/app/api/events/route.ts`)

**Purpose**: Real-time event streaming to clients using Server-Sent Events.

**Critical Implementation Details**:

- **Persistent connections** - clients maintain long-lived connections
- **Multiple event types** - heartbeat, operation_update, scheduler_event
- **Event listeners** - listens to both OperationManager and SchedulerService events
- **Automatic cleanup** - handles client disconnects and server shutdown

**Event Types**:

1. `connection` - Initial connection acknowledgment
2. `heartbeat` - Every 30 seconds to keep connection alive
3. `operation_status` - Every 5 seconds if active operations exist
4. `operation_update` - Immediate when any operation status changes
5. `scheduler_event` - When scheduler processes operations

#### 4. Client-side SSE Hook (`src/hooks/useSSE.ts`)

**Purpose**: React hook for managing SSE connections with auto-reconnection.

**Critical Implementation Details**:

- **EventSource API** - browser-native SSE implementation
- **Auto-reconnection** - 5-second retry on connection loss
- **Event parsing** - converts SSE data to structured events
- **Connection state** - tracks connected/disconnected status

#### 5. Background Operations Hook (`src/hooks/useOperations.ts`)

**Purpose**: React hook for managing background operations from client-side.

**Critical Implementation Details**:

- **Operation creation** - starts background interview creation/destruction
- **Status tracking** - monitors operation progress via API
- **Integration with SSE** - responds to real-time operation updates

## Development Guidelines

### Code Style and Conventions

#### TypeScript Usage

- **Strict mode enabled** - all code must pass strict TypeScript checks
- **Explicit interfaces** - define clear interfaces for all data structures
- **No `any` types** - use proper type annotations or `unknown`
- **Error handling** - use typed error responses

Example:

```typescript
interface OperationEvent {
  type: 'operation_update'
  operation: Operation
  timestamp: string
}

// Good: Explicit typing
const handleEvent = (event: OperationEvent): void => {
  // Implementation
}

// Bad: Using any
const handleEvent = (event: any) => {
  // Implementation
}
```

#### React Patterns

- **Functional components** - no class components
- **Hooks for state** - useState, useEffect, useCallback, useMemo
- **Custom hooks** - extract reusable logic into custom hooks
- **SSE integration** - use useSSE hook for real-time updates

Example:

```typescript
// Good: Custom hook with SSE integration
const MyComponent = () => {
  const { connected, lastEvent } = useSSE('/api/events')
  const [data, setData] = useState([])

  useEffect(() => {
    if (lastEvent?.type === 'operation_update') {
      // Update UI based on SSE event
      refreshData()
    }
  }, [lastEvent])

  return <div>Content</div>
}
```

#### API Route Patterns

- **RESTful design** - follow REST conventions for endpoints
- **Background operations** - all long-running tasks via operation system
- **Error handling** - consistent error response format
- **SSE integration** - emit events on all operation changes

Example:

```typescript
// Good: Background operation with SSE events
export async function POST(request: NextRequest) {
  const operationId = operationManager.createOperation('create', interviewId)

  // Start background work
  setImmediate(async () => {
    operationManager.updateOperationStatus(operationId, 'running') // Emits SSE
    const result = await doWork()
    operationManager.setOperationResult(operationId, result) // Emits SSE
  })

  return NextResponse.json({ operationId })
}
```

### Real-time Architecture Requirements

#### SSE Event Emission Rules

**CRITICAL**: Every operation status change MUST trigger SSE events.

**Required SSE Events**:

1. Operation creation → `operation_update` event
2. Status changes → `operation_update` event
3. Operation completion → `operation_update` event
4. Scheduler processing → `scheduler_event` event

**Implementation Pattern**:

```typescript
// ALWAYS emit after operation changes
operationManager.updateOperationStatus(operationId, 'running')
// ↳ This automatically calls emit() and triggers SSE event

operationManager.setOperationResult(operationId, result)
// ↳ This automatically calls emit() and triggers SSE event
```

#### Client-side SSE Integration Rules

**CRITICAL**: UI updates must be driven by SSE events, not polling.

**Required Pattern**:

```typescript
// Good: SSE-driven updates
const { lastEvent } = useSSE('/api/events')

useEffect(() => {
  if (lastEvent?.type === 'operation_update') {
    refreshInterviews() // Only refresh when SSE event received
  }
}, [lastEvent])

// Bad: Manual polling
useEffect(() => {
  const interval = setInterval(refreshInterviews, 5000) // Don't do this
  return () => clearInterval(interval)
}, [])
```

#### Scheduling Requirements

**CRITICAL**: All interviews must have auto-destroy to prevent resource waste.

**Required Pattern**:

```typescript
// Auto-destroy is MANDATORY
const requestBody = {
  candidateName: formData.candidateName,
  challenge: formData.challenge,
  autoDestroyMinutes: formData.autoDestroyMinutes, // REQUIRED: 30-240 minutes
}

if (formData.enableScheduling && formData.scheduledAt) {
  requestBody.scheduledAt = formData.scheduledAt // Optional scheduling
}
```

### Testing Requirements

#### Unit Testing Rules

- **Test business logic** - focus on operation management, scheduling logic
- **Mock external dependencies** - AWS services, file system operations
- **Test SSE event emission** - verify events are emitted on status changes
- **Test error scenarios** - operation failures, AWS errors

Example:

```typescript
// Good: Testing SSE event emission
test('operation status update emits SSE event', () => {
  const mockListener = jest.fn()
  operationManager.addEventListener(mockListener)

  operationManager.updateOperationStatus('op-123', 'running')

  expect(mockListener).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'operation_update',
      operation: expect.objectContaining({ status: 'running' }),
    })
  )
})
```

#### Integration Testing Rules

- **API routes** - test complete request/response cycles
- **Background operations** - test operation creation and status updates
- **Error handling** - test failure scenarios and error responses

#### E2E Testing Rules

- **User workflows** - test complete interview creation/destruction flows
- **Real browser testing** - use Playwright with real EventSource API
- **Mock external services** - mock AWS responses for consistent testing

#### Manual Testing Requirements

**CRITICAL**: SSE features require manual testing since EventSource API is not available in Node.js.

**Required Manual Tests**:

1. **SSE Connection**: Verify connection indicator shows "Live updates"
2. **Real-time Updates**: Create interview → UI updates instantly without refresh
3. **Scheduling**: Schedule interview → shows correct scheduled times → auto-starts
4. **Auto-destroy**: Verify auto-destroy countdown → automatic cleanup
5. **Error Handling**: Test connection loss → auto-reconnection

### Error Handling Patterns

#### API Error Responses

```typescript
// Consistent error format
return NextResponse.json(
  {
    error: 'User-friendly error message',
    details:
      process.env.NODE_ENV === 'development' ? technicalDetails : undefined,
  },
  { status: 400 }
)
```

#### SSE Error Handling

```typescript
// Graceful SSE error handling
const eventSourceRef = useRef<EventSource | null>(null)

const connect = () => {
  try {
    eventSourceRef.current = new EventSource(url)
    eventSourceRef.current.onerror = () => {
      setConnected(false)
      // Auto-reconnect after 5 seconds
      setTimeout(connect, 5000)
    }
  } catch (error) {
    console.error('SSE connection error:', error)
    setConnected(false)
  }
}
```

#### Operation Error Handling

```typescript
// Operations should handle errors gracefully
setImmediate(async () => {
  try {
    operationManager.updateOperationStatus(operationId, 'running')
    const result = await terraformManager.createInterview(instance)

    if (result.success) {
      operationManager.setOperationResult(operationId, result)
    } else {
      operationManager.setOperationResult(operationId, {
        success: false,
        error: result.error,
      })
    }
  } catch (error) {
    operationManager.setOperationResult(operationId, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})
```

## Common Implementation Patterns

### Creating New API Endpoints

1. **Create route file** in appropriate directory under `src/app/api/`
2. **Use background operations** for any long-running tasks
3. **Emit SSE events** on all operation status changes
4. **Handle errors consistently** with standard error format
5. **Add unit tests** for the route logic

### Adding New Real-time Features

1. **Identify operation type** - determine if it needs background processing
2. **Use OperationManager** - create operations and emit events on changes
3. **Update SSE handler** - ensure new event types are properly streamed
4. **Update client hooks** - handle new event types in useSSE or useOperations
5. **Add manual testing** - verify real-time behavior in browser

### Extending Scheduling System

1. **Update Operation interface** - add new scheduling fields if needed
2. **Modify SchedulerService** - add logic for new scheduling types
3. **Emit scheduler events** - ensure scheduler actions trigger SSE events
4. **Update UI components** - show new scheduling options and status
5. **Test timing logic** - verify scheduling works with different time zones

## Security Considerations

### AWS Authentication

- **Development**: Use AWS SSO profiles with `AWS_PROFILE` environment variable
- **Production**: Use ECS task roles (no environment variables needed)
- **Validation**: Always validate AWS credentials before making AWS API calls

### Input Validation

- **TypeScript types** - use strict typing for all inputs
- **Runtime validation** - validate request bodies in API routes
- **Sanitization** - sanitize user inputs before storage or display

### Error Information

- **Production**: Never expose sensitive information in error messages
- **Development**: Include detailed error information for debugging
- **Logging**: Log detailed errors server-side, return generic messages to clients

## Performance Considerations

### SSE Connection Management

- **Single connection per client** - don't create multiple SSE connections
- **Heartbeat mechanism** - 30-second heartbeats to detect connection issues
- **Automatic cleanup** - properly close connections on client disconnect

### Operation Storage

- **Periodic cleanup** - remove old operations (keep last 50)
- **Efficient queries** - optimize operation lookups and filtering
- **Memory management** - prevent unlimited operation accumulation

### Background Processing

- **Non-blocking operations** - use setImmediate for background work
- **Timeout handling** - implement reasonable timeouts for AWS operations
- **Resource cleanup** - ensure proper cleanup on operation failures

## Debugging Guidelines

### SSE Connection Issues

1. **Check browser DevTools** - Network tab for EventSource connections
2. **Verify endpoint** - ensure `/api/events` is accessible and returns proper headers
3. **Check connection indicator** - should show "Live updates" when connected
4. **Monitor heartbeats** - should see periodic heartbeat events

### Operation Processing Issues

1. **Check operation logs** - detailed logs available via operation dashboard
2. **Verify SSE events** - ensure status changes trigger events
3. **Check scheduler** - verify scheduled operations are processed
4. **Monitor AWS resources** - check CloudWatch logs for AWS operation details

### Build and Test Issues

1. **TypeScript errors** - run `npx tsc --noEmit` to check types
2. **Test failures** - use `test.only()` to focus on specific failing tests
3. **E2E issues** - use `npm run test:e2e:ui` for interactive debugging
4. **Format issues** - run `npm run format` to fix code formatting

This document provides the detailed technical guidance needed for AI developers to effectively work with the Prequel Portal's real-time architecture and scheduling system.
