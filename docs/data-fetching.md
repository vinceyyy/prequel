# Data Fetching Architecture

This document describes the data fetching patterns used in the Prequel Portal application.

## Overview

The portal uses a **polling-based architecture** for real-time data updates. This replaced the previous Server-Sent Events (SSE) implementation for simplicity and easier debugging.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │  usePolling()   │     │    OperationDashboard           │   │
│  │  (1s interval)  │     │    (3s interval for ops)        │   │
│  │                 │     │    (3s interval for logs)       │   │
│  │  activeOnly=true│     │                                 │   │
│  └────────┬────────┘     └────────────────┬────────────────┘   │
│           │                               │                     │
└───────────┼───────────────────────────────┼─────────────────────┘
            │                               │
            ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js API Routes                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  GET /api/operations?activeOnly=true  ──► GSI Query (fast)      │
│  GET /api/operations?interviewId=xxx  ──► GSI Query (fast)      │
│  GET /api/operations                  ──► Table Scan (slow)     │
│  GET /api/operations/:id/logs         ──► Single Item Query     │
│  GET /api/interviews                  ──► DynamoDB + Operations │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DynamoDB                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Operations Table                                               │
│  ├── Primary Key: id                                            │
│  ├── GSI: status-index (for activeOnly queries)                 │
│  └── GSI: interviewId-index (for interview-specific queries)    │
│                                                                 │
│  Interviews Table                                               │
│  ├── Primary Key: id                                            │
│  └── GSI: status-index (for active interviews)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Client-Side Hooks

### 1. `usePolling` Hook

**Location:** `src/hooks/usePolling.ts`

The primary polling hook for fetching active operations. Uses a fixed 1-second interval.

```typescript
const {
  operations,        // Current operations array
  hasActiveOperations, // Boolean: any pending/running/scheduled ops
  lastUpdated,       // Timestamp of last successful fetch
  isLoading,         // Currently fetching
  error,             // Error message if fetch failed
  refresh,           // Manual refresh function
} = usePolling({
  filterPrefix: 'INTERVIEW#',  // Optional: filter by interview type
  interval: 1000,              // Polling interval (default: 1000ms)
})
```

**Key Features:**
- Polls `/api/operations?activeOnly=true` for efficient GSI queries
- Client-side filtering by `filterPrefix` (e.g., `INTERVIEW#` or `TAKEHOME#`)
- Change detection via JSON comparison to trigger `onOperationsChange` callback
- Cache-busting via timestamp query parameter

### 2. `useOperationPolling` Hook

**Location:** `src/hooks/usePolling.ts`

A wrapper around `usePolling` that tracks the most recently changed operation. Useful for triggering side effects when specific operations change status.

```typescript
const {
  ...pollingResult,  // All usePolling results
  lastOperation,     // Most recently changed operation
} = useOperationPolling({
  filterPrefix: 'INTERVIEW#',
})
```

### 3. `useOperations` Hook

**Location:** `src/hooks/useOperations.ts`

Provides CRUD operations for interviews. Does NOT poll - relies on `usePolling` for real-time updates.

```typescript
const {
  operations,        // Operations array (loaded once on mount)
  loading,           // Loading state for mutations
  createInterview,   // Create interview function
  destroyInterview,  // Destroy interview function
  refreshOperations, // Manual refresh
} = useOperations(interviewId?)
```

## Component-Level Polling

### OperationDashboard

**Location:** `src/components/OperationDashboard.tsx`

The OperationDashboard maintains its own polling for two purposes:

1. **Operations Polling (3s):** Fetches operations for display when active operations exist
2. **Log Polling (3s):** Fetches logs for the selected operation when it's active

```
┌─────────────────────────────────────────────────────────┐
│                  OperationDashboard                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Operations Polling (3s interval)                       │
│  ├── Triggered when: hasActiveOperations = true         │
│  ├── Endpoint: /api/operations?interviewId=xxx          │
│  └── Stops when: no active operations                   │
│                                                         │
│  Log Polling (3s interval)                              │
│  ├── Triggered when: selected op is pending/running     │
│  ├── Endpoint: /api/operations/:id/logs                 │
│  └── Stops when: selected op completes/fails            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## API Endpoints

### Operations Endpoints

| Endpoint | Method | Query Params | Performance | Use Case |
|----------|--------|--------------|-------------|----------|
| `/api/operations` | GET | none | Slow (table scan) | Admin: view all ops |
| `/api/operations` | GET | `activeOnly=true` | Fast (GSI) | Polling: active ops |
| `/api/operations` | GET | `interviewId=xxx` | Fast (GSI) | Dashboard: specific interview |
| `/api/operations/:id/logs` | GET | `from=N` | Fast | Log streaming |
| `/api/operations/:id/cancel` | POST | none | Fast | Cancel operation |

### Interview Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/interviews` | GET | List active interviews (DynamoDB + operations merge) |
| `/api/interviews/create` | POST | Create new interview (starts background operation) |
| `/api/interviews/:id/destroy` | POST | Destroy interview (starts background operation) |

## Data Flow Examples

### 1. Page Load

```
Browser                    Server                     DynamoDB
   │                          │                          │
   │──GET /api/interviews────►│                          │
   │                          │──Query interviews────────►│
   │                          │◄─────────────────────────│
   │                          │──Query active ops────────►│
   │                          │◄─────────────────────────│
   │◄─────────────────────────│ (merged result)          │
   │                          │                          │
   │──GET /api/operations─────►│                          │
   │   ?activeOnly=true       │──GSI Query───────────────►│
   │◄─────────────────────────│◄─────────────────────────│
```

### 2. Polling Cycle (1-second)

```
Browser (usePolling)       Server                     DynamoDB
   │                          │                          │
   │──GET /api/operations─────►│                          │
   │   ?activeOnly=true&t=xxx │──GSI Query───────────────►│
   │◄─────────────────────────│◄─────────────────────────│
   │                          │                          │
   │  [Compare with previous] │                          │
   │  [Update state if changed]                          │
   │  [Trigger onOperationsChange if changed]            │
   │                          │                          │
   │  ... wait 1 second ...   │                          │
   │                          │                          │
   │──GET /api/operations─────►│                          │
   │   ?activeOnly=true&t=xxx │                          │
   └──────────────────────────┴──────────────────────────┘
```

### 3. Interview Creation Flow

```
Browser                    Server                     DynamoDB
   │                          │                          │
   │──POST /api/interviews────►│                          │
   │     /create              │──Create operation────────►│
   │                          │◄─────────────────────────│
   │◄─────operationId─────────│                          │
   │                          │                          │
   │  [Polling detects new operation]                    │
   │                          │                          │
   │──GET /api/operations─────►│                          │
   │   ?activeOnly=true       │──GSI Query───────────────►│
   │◄─────[status: pending]───│◄─────────────────────────│
   │                          │                          │
   │  ... 1 second later ...  │                          │
   │                          │                          │
   │──GET /api/operations─────►│                          │
   │   ?activeOnly=true       │──GSI Query───────────────►│
   │◄─────[status: running]───│◄─────────────────────────│
   │                          │                          │
   │  ... operation completes │                          │
   │                          │                          │
   │──GET /api/operations─────►│                          │
   │   ?activeOnly=true       │──GSI Query───────────────►│
   │◄─────[status: completed]─│◄─────────────────────────│
```

## Performance Considerations

### DynamoDB Query Types

1. **GSI Queries (Fast):** ~10-50ms
   - `activeOnly=true` → queries status GSI
   - `interviewId=xxx` → queries interviewId GSI

2. **Table Scans (Slow):** ~100-500ms+
   - No query parameters → scans entire table
   - Avoid in production polling

### Polling Intervals

| Component | Interval | Query Type | Cost |
|-----------|----------|------------|------|
| usePolling | 1s | GSI (activeOnly) | ~$0.16/user/month |
| OperationDashboard (ops) | 3s | GSI (interviewId) | Minimal |
| OperationDashboard (logs) | 3s | Single item | Minimal |

### Cost Estimation

```
1 request/second × 3600 sec/hr × 8 hrs/day × 22 days/month
= ~633,000 requests/month per active browser tab
= ~$0.16/month per active user (at $0.25 per million RRUs)
```

## Best Practices

1. **Always use `activeOnly=true`** for polling to avoid table scans
2. **Use `interviewId` filter** when viewing specific interview details
3. **Client-side filtering** via `filterPrefix` for separating interview types
4. **Change detection** prevents unnecessary re-renders
5. **Cache-busting** via timestamp prevents stale responses

## Debugging

### Common Issues

1. **Performance warning in logs:**
   ```
   [PERFORMANCE] Using full table scan for getAllOperations()
   ```
   → Add `activeOnly=true` query parameter

2. **Stale data:**
   → Check if cache-busting timestamp is being added
   → Verify polling interval is running

3. **Missing operations:**
   → Check `filterPrefix` matches expected pattern
   → Verify GSI indexes exist in DynamoDB

### Debug Logging

Enable debug logs by checking browser console for:
- `[DEBUG] OperationDashboard: Active operations detected...`
- `[DEBUG] Starting log polling for active operation...`
- `[Polling] Setting interval to...` (if using old smart polling)
