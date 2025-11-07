# Take-Home Test Real-Time Flow Design

**Date:** 2025-01-07
**Status:** Approved
**Goal:** Implement real-time status updates for take-home tests with candidate page persistence and unified data model

## Overview

This design unifies take-home tests and regular interviews into a single table, implements real-time status updates via SSE, and ensures candidates stay on their dedicated take-home page throughout the entire test lifecycle.

## Requirements

### Candidate Experience
1. Candidate stays on `/take-home/[passcode]` page after clicking "Start Test"
2. Real-time progress display during provisioning (Initializing → Configuring → Active)
3. Display URL and password when workspace is ready
4. Show countdown timer for remaining time
5. Page refresh shows current status (safe to close and reopen)

### Admin Experience
1. Take-home tests stay in "Take-Home Tests" tab (never move to "Current Interviews")
2. Real-time status updates via SSE without manual refresh
3. Inline display of access details when ready
4. Logs button opens operation logs modal (same as regular interviews)
5. Revoke button destroys running instance or cancels invitation

### Technical Requirements
1. Merge `takehome` table into `interviews` table
2. Auto-sync operation status to interview records
3. SSE events trigger UI updates on both admin and candidate pages
4. No polling - all updates via SSE
5. Maintain backward compatibility during migration

## Architecture

### 1. Unified Data Model

**Merge `takehome` table into `interviews` table:**

```typescript
interface Interview {
  id: string  // 'int-xxx' for regular, 'takehome-xxx' for take-home
  candidateName: string
  challenge: string
  status: InterviewStatus
  type: 'regular' | 'take-home'  // NEW: Differentiates types

  // Access credentials
  accessUrl?: string
  password?: string

  // Common lifecycle
  createdAt: Date
  autoDestroyAt?: Date  // Mandatory for both types
  completedAt?: Date
  destroyedAt?: Date

  // Regular interview specific
  scheduledAt?: Date

  // Take-home specific
  passcode?: string   // 8-char code for candidate access
  validUntil?: Date   // Invitation expiry
  customInstructions?: string
  durationMinutes?: number
  activatedAt?: Date  // When candidate clicked "Start Test"

  // File management
  saveFiles?: boolean
  historyS3Key?: string
  ttl?: number
}
```

**DynamoDB Indexes:**

1. **Primary Key:** `id` (existing)
2. **StatusIndex (GSI):** `status` + `createdAt` (existing)
3. **PasscodeIndex (GSI - NEW):** `passcode` (for take-home lookup)
4. **TypeStatusIndex (GSI - NEW):** `type` + `status` (for filtering)

### 2. Status Flow

**Take-Home Lifecycle:**

```
1. Creation (Admin creates take-home):
   - Interview created: type='take-home', status='active'
   - No operation yet, just invitation

2. Activation (Candidate clicks "Start Test"):
   - Interview updated: status='activated', activatedAt=now
   - Operation created: type='create', status='pending'

3. Provisioning:
   - Operation: status='running'
   - Interview: status='initializing'

4. Infrastructure Ready:
   - Interview: status='configuring', accessUrl & password set

5. Workspace Ready:
   - Operation: status='completed'
   - Interview: status='active' (running)

6. Auto-Destroy:
   - Scheduler triggers destroy
   - Interview: status='completed', completedAt set
```

**Status Mapping (Operation → Interview):**

```typescript
const statusMap = {
  'pending': 'scheduled',
  'running': 'initializing',
  // 'configuring' set by infrastructure ready callback
  'completed': 'active',
  'failed': 'error',
  'cancelled': 'error',
}
```

### 3. SSE Integration

**Operation-Interview Sync:**

```typescript
// In operations.ts
async setOperationResult(operationId: string, result: OperationResult) {
  // Update operation
  const operation = await this.updateOperation(operationId, { result, status })

  // Sync interview status
  if (operation.interviewId) {
    await this.syncInterviewStatus(operation)
  }

  // Emit SSE event
  this.emit(operation)
}

private async syncInterviewStatus(operation: Operation) {
  const interviewStatus = statusMap[operation.status]

  await interviewManager.updateInterviewStatus(
    operation.interviewId,
    interviewStatus,
    {
      accessUrl: operation.result?.accessUrl,
      password: operation.result?.password,
    }
  )
}
```

**Admin Dashboard SSE:**

```typescript
const { lastEvent } = useSSE('/api/events')

useEffect(() => {
  if (lastEvent?.type === 'operation_update') {
    // Refresh interviews (includes take-homes)
    loadInterviews()
  }
}, [lastEvent])
```

**Candidate Page SSE:**

```typescript
const { lastEvent } = useSSE('/api/events')

useEffect(() => {
  if (lastEvent?.type === 'operation_update') {
    const op = lastEvent.operation
    if (op.interviewId === interview?.id) {
      fetchInterview(passcode)
    }
  }
}, [lastEvent, interview?.id])
```

### 4. API Endpoints

**New Endpoints:**

```typescript
// GET /api/interviews/by-passcode/[passcode]
// Returns interview by passcode lookup
export async function GET(request, { params }) {
  const { passcode } = await params
  const interview = await interviewManager.getInterviewByPasscode(passcode)
  return NextResponse.json(interview)
}

// POST /api/interviews/[id]/activate
// Activates take-home test (updates existing interview)
export async function POST(request, { params }) {
  const { id } = await params

  // Validate it's a take-home
  const interview = await interviewManager.getInterview(id)
  if (interview.type !== 'take-home') {
    return error('Not a take-home test')
  }

  // Update to activated
  await interviewManager.updateInterviewStatus(id, 'activated', {
    activatedAt: new Date()
  })

  // Create operation and start provisioning
  const operationId = await operationManager.createOperation(...)
  // ... rest of provisioning logic

  return NextResponse.json({ operationId, interviewId: id })
}
```

**Modified Endpoints:**

```typescript
// POST /api/takehome (create take-home)
// Now creates interview record with type='take-home'
export async function POST(request) {
  const body = await request.json()

  // Create interview record
  const interview = await interviewManager.createInterview({
    id: `takehome-${timestamp}-${random}`,
    type: 'take-home',
    status: 'active',  // Invitation is active
    passcode: generatePasscode(),
    validUntil: calculateValidUntil(body.validDays),
    customInstructions: body.customInstructions,
    durationMinutes: body.durationMinutes,
    candidateName: body.candidateName,
    challenge: body.challenge,
    autoDestroyAt: null, // Set when activated
  })

  return NextResponse.json({ interview })
}
```

## UI Components

### Candidate Page (`/take-home/[passcode]/page.tsx`)

**States:**

1. **Not Started:** Show instructions + "Start Test" button
2. **Activating:** Show spinner "Starting your test..."
3. **Initializing:** Show progress "Provisioning infrastructure..." (3-5 min estimate)
4. **Configuring:** Show progress "Setting up environment..."
5. **Active/Ready:** Show access card with URL, password, countdown timer
6. **Completed:** Show "Test completed" message

**Component Structure:**

```tsx
export default function TakeHomePage({ params }) {
  const { passcode } = use(params)
  const [interview, setInterview] = useState<Interview | null>(null)
  const { lastEvent } = useSSE('/api/events')

  // Load interview
  useEffect(() => {
    fetchInterview()
  }, [passcode])

  // SSE updates
  useEffect(() => {
    if (lastEvent?.type === 'operation_update') {
      if (lastEvent.operation.interviewId === interview?.id) {
        fetchInterview()
      }
    }
  }, [lastEvent])

  const handleStart = async () => {
    await fetch(`/api/interviews/${interview.id}/activate`, { method: 'POST' })
    fetchInterview() // Refresh to get activated status
  }

  return (
    <div>
      {interview.status === 'active' && <StartButton onClick={handleStart} />}
      {interview.status === 'activated' && <Progress status="Starting..." />}
      {interview.status === 'initializing' && <Progress status="Provisioning..." />}
      {interview.status === 'configuring' && <Progress status="Configuring..." />}
      {interview.status === 'active' && interview.accessUrl && (
        <AccessDetails url={interview.accessUrl} password={interview.password} />
      )}
      {interview.status === 'completed' && <CompletedMessage />}
    </div>
  )
}
```

### Admin Dashboard (Take-Home Tests Tab)

**Table Display:**

```tsx
function TakehomeTestsTab() {
  const interviews = allInterviews.filter(i =>
    i.type === 'take-home' &&
    i.status !== 'completed'
  )

  return (
    <table>
      <thead>
        <tr>
          <th>Candidate</th>
          <th>Challenge</th>
          <th>URL</th>
          <th>Status</th>
          <th>Valid Until</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {interviews.map(interview => (
          <tr key={interview.id}>
            <td>{interview.candidateName}</td>
            <td>{interview.challenge}</td>
            <td>
              <CopyButton text={`/take-home/${interview.passcode}`} />
            </td>
            <td>
              <StatusBadge status={interview.status} />
              {interview.accessUrl && (
                <div className="text-xs">
                  <div>URL: {interview.accessUrl}</div>
                  <div>Password: {interview.password}</div>
                  <div>Time left: {formatTimeRemaining(interview.autoDestroyAt)}</div>
                </div>
              )}
              {(interview.status === 'initializing' || interview.status === 'configuring') && (
                <div className="text-xs">
                  <Spinner /> Provisioning...
                </div>
              )}
            </td>
            <td>{formatDate(interview.validUntil)}</td>
            <td>
              <LogsButton interviewId={interview.id} />
              <RevokeButton interviewId={interview.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

**Status Badges:**

```typescript
const getStatusBadge = (status: string) => {
  switch (status) {
    case 'active': return <Badge color="green">Available</Badge>
    case 'activated': return <Badge color="blue">Activated</Badge>
    case 'initializing': return <Badge color="blue">Provisioning</Badge>
    case 'configuring': return <Badge color="yellow">Configuring</Badge>
    case 'active' + accessUrl: return <Badge color="green">Running</Badge>
    case 'completed': return <Badge color="gray">Completed</Badge>
    case 'error': return <Badge color="red">Error</Badge>
  }
}
```

## Implementation Plan

### Phase 1: Database Schema
1. Add new fields to `interviews` table schema
2. Create new DynamoDB indexes (PasscodeIndex, TypeStatusIndex)
3. Update Interview TypeScript interfaces

### Phase 2: Core Logic
1. Update `interviewManager.createInterview()` to support type='take-home'
2. Add `interviewManager.getInterviewByPasscode()`
3. Update `operationManager` to sync interview status on changes
4. Modify take-home creation API to create interview records

### Phase 3: API Endpoints
1. Create `GET /api/interviews/by-passcode/[passcode]`
2. Create `POST /api/interviews/[id]/activate`
3. Update `POST /api/takehome` to create unified interview records
4. Update `POST /api/takehome/[passcode]/revoke` to work with interviews

### Phase 4: Candidate Page
1. Update `/take-home/[passcode]/page.tsx` with SSE integration
2. Add real-time status display components
3. Add access details card with URL/password/countdown
4. Handle all status states (not started → running → completed)

### Phase 5: Admin Dashboard
1. Update "Take-Home Tests" tab to filter interviews by type
2. Add inline status display with real-time updates
3. Update TakehomeTable component with new columns
4. Ensure SSE updates trigger re-renders

### Phase 6: Migration & Cleanup
1. Keep old takehome table for backward compatibility
2. Add code to read from both sources temporarily
3. Migrate existing take-home records (optional)
4. Remove old takehome-specific code after validation

## Testing Strategy

### Unit Tests
- Interview CRUD with type='take-home'
- Passcode lookup queries
- Status sync from operations to interviews
- SSE event handling

### Integration Tests
- Full take-home creation → activation → provisioning flow
- Status updates propagate correctly
- SSE events trigger UI updates

### Manual Tests
1. Create take-home test as admin
2. Open candidate page, verify instructions display
3. Click "Start Test", verify real-time progress
4. Verify workspace URL/password appear when ready
5. Close and reopen page, verify status persists
6. Verify admin dashboard shows real-time status
7. Test revoke functionality

## Migration Strategy

**Backward Compatibility:**
- Keep old `takehome` table during transition
- New take-homes write to unified `interviews` table
- Code reads from both sources (old takehome table + new interviews)
- Gradually migrate or let old records expire naturally

**Rollback Plan:**
- If issues arise, revert to old takehome table
- Unified schema is additive (doesn't break existing interviews)
- Can toggle between old/new via feature flag

## Success Criteria

✅ Candidate stays on `/take-home/[passcode]` page throughout lifecycle
✅ Real-time status updates visible to both candidate and admin
✅ Take-home tests never appear in "Current Interviews" tab
✅ Access details display inline in admin dashboard
✅ Logs button works for take-home tests
✅ No polling - all updates via SSE
✅ Page refresh safe (status persists)
✅ Backward compatible with existing take-homes

## Notes

- This design unifies the data model while maintaining separation in the UI
- SSE provides real-time updates without polling overhead
- Status mapping ensures consistent state across operations and interviews
- Candidate page is completely isolated from admin portal
