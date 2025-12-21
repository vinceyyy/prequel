# Data Fetching Architecture

This document describes how the Prequel Portal fetches and displays real-time data.

## Overview

The portal uses a **state-based polling** approach where:

1. **Interviews page** polls `/api/interviews` every 1 second
2. **Take-homes page** polls `/api/takehomes` every 1 second
3. Server-side endpoints handle all data merging and status mapping

This is simpler than the previous operations-based approach where clients polled operations and mapped status client-side.

## Data Flow

```
┌─────────────────┐     1s interval      ┌──────────────────────┐
│  React Client   │ ──────────────────►  │  /api/interviews     │
│                 │                      │  or /api/takehomes   │
│  useInterview   │ ◄──────────────────  │                      │
│  Polling()      │   Complete state     │  Merges:             │
│                 │   (interviews with   │  - DynamoDB records  │
│  useTakeHome    │    operation status) │  - Active operations │
│  Polling()      │                      │                      │
└─────────────────┘                      └──────────────────────┘
```

## Polling Hooks

### `useInterviewPolling()`

Polls `/api/interviews` for real-time interview data.

```typescript
const {
  interviews, // InterviewData[] - all active interviews
  hasInProgressInterviews, // boolean - any initializing/configuring/destroying
  lastUpdated, // Date | null - last successful fetch time
  isLoading, // boolean - true only on initial load (not during polls)
  error, // string | null - last error message
  refresh, // () => Promise<void> - manual refresh
} = useInterviewPolling()
```

### `useTakeHomePolling()`

Polls `/api/takehomes` for real-time take-home data.

```typescript
const {
  takeHomes, // TakeHomeData[] - all take-homes
  hasInProgressTakeHomes, // boolean - any initializing/configuring/destroying
  lastUpdated, // Date | null
  isLoading, // boolean
  error, // string | null
  refresh, // () => Promise<void>
} = useTakeHomePolling()
```

### `useOperationPolling()`

Polls `/api/operations` for operation status changes. Used only for toast notifications.

```typescript
const { lastOperation } = useOperationPolling({
  filterPrefix: 'INTERVIEW#', // or 'TAKEHOME#'
})
```

## Server-Side Merging

The `/api/interviews` endpoint handles all complexity:

1. **Gets active interviews** from DynamoDB (indexed query by status)
2. **Gets active operations** from DynamoDB (pending, running, scheduled)
3. **Maps operation status to interview status**:
   - `pending` → `initializing`
   - `running` + !infrastructureReady → `initializing`
   - `running` + infrastructureReady → `configuring`
   - `completed` + success + healthCheckPassed → `active`
   - `completed` + !success → `error`
   - `failed` → `error`
4. **Merges and deduplicates** with preference for DynamoDB data
5. **Applies destroy status** for interviews being destroyed
6. **Returns unified list** sorted by creation time

This means clients receive the **complete current state** with every poll - no client-side status mapping required.

## Why 1-Second Polling?

- **Cost**: ~$0.16/month per user (negligible)
- **Latency**: Worst case 1 second delay for status updates
- **Complexity**: Much simpler than websockets or SSE
- **Reliability**: No connection management, auto-recovery on network issues

## Toast Notifications

Operation polling is kept separate for toast notifications:

```typescript
// Track operation completions for toast notifications only
const previousOperationRef = useRef<OperationData | null>(null)
useEffect(() => {
  if (!lastOperation) return

  // Show toast for completed operations
  if (operation.status === 'completed' && operation.type === 'create') {
    if (operation.result?.success) {
      setNotification(`Interview ready for ${operation.candidateName}`)
    }
  }
}, [lastOperation])
```

This allows showing immediate feedback when operations complete, without duplicating the state management logic.

## Best Practices

1. **Don't manually update state** - let polling handle it
2. **Use refresh() sparingly** - polling will update within 1 second
3. **Keep operation polling for toasts only** - don't use it for state management
4. **Server handles status mapping** - don't duplicate logic client-side
