# Separate Interview and Take-Home Test Workflows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Completely separate interview and take-home test creation workflows with dedicated buttons, modals, and history tracking.

**Architecture:** Split the unified "Create New Interview" modal into two separate modals: one for interviews (with scheduling checkbox) and one for take-home tests. Add a separate "Take-Home Test History" tab to track completed/expired take-home tests separately from interview history.

**Tech Stack:** Next.js 15 App Router, React hooks, TypeScript, TailwindCSS, DynamoDB

---

## Current State Analysis

**Current Issues:**

1. Single "Create New Interview" button opens modal with interview type selector (Instant/Scheduled/Take-Home)
2. Take-home tests mix with interviews in the creation flow
3. Completed/expired take-home tests go to "Interview History" tab (mixed with actual interviews)

**Desired State:**

1. Two separate buttons: "Create Interview" and "Create Take-Home Test"
2. "Create Interview" modal has scheduling checkbox (no type selector)
3. "Create Take-Home Test" modal has no type selector
4. New "Take-Home Test History" tab for completed/expired/revoked take-home tests

---

## Task 1: Update UI State Management

**Goal:** Add separate state for take-home modal and remove interview type selector logic.

**Files:**

- Modify: `portal/src/app/page.tsx:259-293`

**Step 1: Add showCreateTakehomeForm state variable**

In `portal/src/app/page.tsx`, add new state variable after line 261:

```typescript
const [showCreateForm, setShowCreateForm] = useState(false)
const [showCreateTakehomeForm, setShowCreateTakehomeForm] = useState(false) // NEW
const [loading, setLoading] = useState(false)
```

**Step 2: Remove interviewType state variable**

Delete lines 284-286:

```typescript
// DELETE THESE LINES:
const [interviewType, setInterviewType] = useState<
  'instant' | 'scheduled' | 'takehome'
>('instant')
```

**Step 3: Update formData to include enableScheduling**

Modify formData state to add back enableScheduling (around line 264):

```typescript
const [formData, setFormData] = useState({
  candidateName: '',
  challenge: '',
  enableScheduling: false, // ADD THIS LINE
  scheduledAt: '',
  autoDestroyMinutes: 240,
  saveFiles: true,
})
```

**Step 4: Verify state changes compile**

Run: `npm run build`

Expected: Build succeeds with no TypeScript errors

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: add separate take-home modal state and restore scheduling checkbox"
```

---

## Task 2: Add Second Button and Update Button Click Handlers

**Goal:** Add "Create Take-Home Test" button next to "Create Interview" button.

**Files:**

- Modify: `portal/src/app/page.tsx:929-937`

**Step 1: Update Create Interview button text and handler**

Modify lines 929-937 to simplify the interview creation button:

```typescript
<div className="mb-6 flex flex-wrap gap-3 items-center justify-between">
  <div className="flex flex-wrap gap-3 items-center">
    <button
      onClick={() => setShowCreateForm(true)}
      className="btn-primary"
    >
      Create Interview
    </button>
    <button
      onClick={() => setShowCreateTakehomeForm(true)}
      className="btn-secondary"
    >
      Create Take-Home Test
    </button>
    <a href="/challenges" className="btn-secondary">
```

**Step 2: Verify buttons render**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add separate Create Take-Home Test button"
```

---

## Task 3: Refactor Interview Modal to Remove Type Selector

**Goal:** Remove interview type selector from Create Interview modal and restore scheduling checkbox.

**Files:**

- Modify: `portal/src/app/page.tsx:1016-1075`

**Step 1: Remove interview type selector UI**

Delete lines 1023-1060 (the entire interview type selector section):

```typescript
// DELETE THIS ENTIRE SECTION:
{/* Interview Type Selection */}
<div className="mb-6">
  <label className="block text-sm font-medium text-slate-700 mb-2">
    Interview Type
  </label>
  <div className="flex gap-2">
    <button onClick={() => setInterviewType('instant')} ...>
      Instant
    </button>
    <button onClick={() => setInterviewType('scheduled')} ...>
      Scheduled
    </button>
    <button onClick={() => setInterviewType('takehome')} ...>
      Take-Home
    </button>
  </div>
</div>
```

**Step 2: Remove conditional form rendering**

Replace lines 1062-1075:

```typescript
// DELETE:
{/* Conditional Forms */}
{interviewType === 'takehome' ? (
  <TakehomeForm ... />
) : (
  <>
```

With:

```typescript
{/* Interview Form */}
<>
```

**Step 3: Add scheduling checkbox back**

After the challenge selection section (around line 1166), add back the scheduling checkbox:

```typescript
{/* Scheduling Options */}
<div className="space-y-3">
  <div className="flex items-center space-x-2">
    <input
      type="checkbox"
      id="enableScheduling"
      checked={formData.enableScheduling}
      onChange={e =>
        setFormData({
          ...formData,
          enableScheduling: e.target.checked,
        })
      }
      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
    />
    <label
      htmlFor="enableScheduling"
      className="text-sm font-medium text-slate-900"
    >
      Schedule for later
    </label>
  </div>

  {formData.enableScheduling && (
    <div>
      <label className="block text-sm font-medium text-slate-900 mb-1">
        Scheduled Start Time
      </label>
      <input
        type="datetime-local"
        value={formData.scheduledAt}
        onChange={e =>
          setFormData({
            ...formData,
            scheduledAt: e.target.value,
          })
        }
        min={new Date().toISOString().slice(0, 16)}
        className="input-field"
      />
    </div>
  )}
```

**Step 4: Update modal close handler**

Find the cancel button handler and remove `setInterviewType('instant')`:

```typescript
// BEFORE:
onClick={() => {
  setShowCreateForm(false)
  setInterviewType('instant')
}}

// AFTER:
onClick={() => {
  setShowCreateForm(false)
}}
```

**Step 5: Update button text logic**

Find the create button text (around line 1208) and update:

```typescript
// BEFORE:
{
  loading
    ? 'Creating...'
    : formData.enableScheduling || interviewType === 'scheduled'
      ? 'Schedule Interview'
      : 'Create Interview'
}

// AFTER:
{
  loading
    ? 'Creating...'
    : formData.enableScheduling
      ? 'Schedule Interview'
      : 'Create Interview'
}
```

**Step 6: Update disabled condition**

Find the disabled condition (around line 1198) and update:

```typescript
// BEFORE:
disabled={
  !formData.candidateName.trim() ||
  !formData.challenge ||
  loading ||
  ((formData.enableScheduling ||
    interviewType === 'scheduled') &&
    !formData.scheduledAt)
}

// AFTER:
disabled={
  !formData.candidateName.trim() ||
  !formData.challenge ||
  loading ||
  (formData.enableScheduling && !formData.scheduledAt)
}
```

**Step 7: Verify modal compiles**

Run: `npm run build`

Expected: Build succeeds

**Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: remove interview type selector and restore scheduling checkbox"
```

---

## Task 4: Create Separate Take-Home Modal Component

**Goal:** Add separate modal for creating take-home tests.

**Files:**

- Modify: `portal/src/app/page.tsx:1228` (after Interview modal)

**Step 1: Add take-home modal after interview modal**

After the closing div of `showCreateForm` modal (around line 1228), add:

```typescript
{showCreateTakehomeForm && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="card p-4 sm:p-6 w-full max-w-md fade-in max-h-[90vh] overflow-y-auto">
      <h2 className="text-xl font-semibold mb-4 text-slate-900">
        Create Take-Home Test
      </h2>

      <TakehomeForm
        formData={takehomeFormData}
        setFormData={setTakehomeFormData}
        challenges={challenges}
        onSubmit={createTakehome}
        onCancel={() => setShowCreateTakehomeForm(false)}
        creating={loading}
      />
    </div>
  </div>
)}
```

**Step 2: Verify modal renders**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add separate Create Take-Home Test modal"
```

---

## Task 5: Add Take-Home Test History Tab

**Goal:** Add new tab for take-home test history.

**Files:**

- Modify: `portal/src/app/page.tsx:256-260` (activeTab type)
- Modify: `portal/src/app/page.tsx:953-1013` (tab navigation)

**Step 1: Update activeTab type to include takehomeHistory**

Modify lines 256-260:

```typescript
// BEFORE:
const [activeTab, setActiveTab] = useState<
  'current' | 'history' | 'takehome' | 'admin'
>('current')

// AFTER:
const [activeTab, setActiveTab] = useState<
  'current' | 'history' | 'takehome' | 'takehomeHistory' | 'admin'
>('current')
```

**Step 2: Add state for take-home history**

After the `takehomes` state (around line 290), add:

```typescript
const [takehomes, setTakehomes] = useState<TakehomeData[]>([])
const [takehomeHistory, setTakehomeHistory] = useState<TakehomeData[]>([]) // NEW
```

**Step 3: Add Take-Home Test History tab button**

After the "Take-Home Tests" tab button (around line 1000), add:

```typescript
<button
  onClick={() => setActiveTab('takehomeHistory')}
  className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
    activeTab === 'takehomeHistory'
      ? 'border-blue-500 text-blue-600'
      : 'border-transparent text-slate-700 hover:text-slate-900 hover:border-slate-300'
  }`}
>
  Take-Home History
  {takehomeHistory.length > 0 && (
    <span className="ml-2 bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
      {takehomeHistory.length}
    </span>
  )}
</button>
```

**Step 4: Add TypeScript interface for TakehomeData**

Add after the `HistoricalInterview` interface (around line 240):

```typescript
interface TakehomeData {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: 'active' | 'activated' | 'completed' | 'revoked'
  validUntil: string
  durationMinutes: number
  createdAt: string
  activatedAt?: string
  interviewId?: string
  url?: string
}
```

**Step 5: Verify tab compiles**

Run: `npm run build`

Expected: Build succeeds with type errors (we'll fix data fetching next)

**Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add Take-Home Test History tab navigation"
```

---

## Task 6: Update fetchTakehomes to Separate Active and History

**Goal:** Split take-home test fetching to separate active tests from historical ones.

**Files:**

- Modify: `portal/src/app/page.tsx:346-377` (fetchTakehomes function)

**Step 1: Update fetchTakehomes to filter by status**

Replace the fetchTakehomes function (lines 346-377):

```typescript
const fetchTakehomes = async () => {
  try {
    const response = await fetch('/api/takehome')
    if (response.ok) {
      const data = await response.json()
      const allTakehomes = data.takehomes || []

      // Separate active and historical take-home tests
      const active = allTakehomes.filter(
        (t: TakehomeData) => t.status === 'active'
      )
      const history = allTakehomes.filter(
        (t: TakehomeData) =>
          t.status === 'completed' ||
          t.status === 'revoked' ||
          (t.status === 'activated' && t.interviewId) // Check if associated interview is complete
      )

      setTakehomes(active)
      setTakehomeHistory(history)
    } else {
      console.error('Failed to fetch take-home tests')
      setTakehomes([])
      setTakehomeHistory([])
    }
  } catch (error) {
    console.error('Error fetching take-home tests:', error)
    setTakehomes([])
    setTakehomeHistory([])
  }
}
```

**Step 2: Add fetchTakehomes to SSE event handler**

Ensure fetchTakehomes is called when SSE events occur (around line 320):

```typescript
useEffect(() => {
  if (lastEvent?.type === 'operation_update') {
    refreshInterviews()
    fetchTakehomes() // ADD THIS LINE if not present
  }
}, [lastEvent])
```

**Step 3: Verify data fetching works**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: separate active and historical take-home tests in data fetching"
```

---

## Task 7: Add Take-Home History Tab Content

**Goal:** Render take-home history tab with TakehomeTable component.

**Files:**

- Modify: `portal/src/app/page.tsx` (after Take-Home Tests tab content)

**Step 1: Add takehomeHistory tab content**

After the "Take-Home Tests" tab content section (search for `{activeTab === 'takehome'`), add:

```typescript
{/* Take-Home Test History Tab */}
{activeTab === 'takehomeHistory' && (
  <div className="card overflow-hidden">
    {takehomeHistory.length === 0 ? (
      <div className="p-6 sm:p-8 text-center text-slate-500">
        <p className="text-lg">No take-home test history yet</p>
        <p className="text-sm mt-2">
          Completed, expired, or revoked take-home tests will appear here
        </p>
      </div>
    ) : (
      <TakehomeTable
        takehomes={takehomeHistory}
        onRevoke={async (passcode) => {
          // History items can't be revoked again
          console.log('Cannot revoke historical take-home test:', passcode)
        }}
      />
    )}
  </div>
)}
```

**Step 2: Verify tab content renders**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add Take-Home Test History tab content"
```

---

## Task 8: Update TakehomeManager to Query Historical Tests

**Goal:** Add method to get historical take-home tests from DynamoDB.

**Files:**

- Modify: `portal/src/lib/takehome.ts:195` (after getActivatedTakehomes)

**Step 1: Add getHistoricalTakehomes method**

Add after the `getActivatedTakehomes` method (around line 220):

```typescript
/**
 * Gets all historical take-home tests (completed or revoked).
 * Uses StatusIndex GSI for efficient querying.
 */
async getHistoricalTakehomes(): Promise<TakehomeTest[]> {
  const historicalStatuses: Array<'completed' | 'revoked'> = [
    'completed',
    'revoked',
  ]

  const results: TakehomeTest[] = []

  for (const status of historicalStatuses) {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'StatusIndex',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': status,
      }),
      ScanIndexForward: false, // Most recent first
    })

    const response = await this.dynamoClient.send(command)
    if (response.Items) {
      results.push(
        ...response.Items.map(item => {
          const unmarshalled = unmarshall(item)
          return {
            ...unmarshalled,
            validUntil:
              typeof unmarshalled.validUntil === 'string'
                ? unmarshalled.validUntil
                : unmarshalled.validUntil.toISOString(),
            createdAt:
              typeof unmarshalled.createdAt === 'string'
                ? unmarshalled.createdAt
                : unmarshalled.createdAt.toISOString(),
            activatedAt: unmarshalled.activatedAt
              ? typeof unmarshalled.activatedAt === 'string'
                ? unmarshalled.activatedAt
                : unmarshalled.activatedAt.toISOString()
              : undefined,
          } as TakehomeTest
        })
      )
    }
  }

  // Sort by createdAt descending (most recent first)
  return results.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}
```

**Step 2: Export the new method in singleton**

Verify the singleton export includes the new method (should be automatic).

**Step 3: Verify TypeScript compiles**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/lib/takehome.ts
git commit -m "feat: add getHistoricalTakehomes method to TakehomeManager"
```

---

## Task 9: Create GET API Endpoint for Historical Take-Home Tests

**Goal:** Add API endpoint to fetch historical take-home tests.

**Files:**

- Modify: `portal/src/app/api/takehome/route.ts:24-78`

**Step 1: Update GET endpoint to support status filtering**

Replace the GET function in `portal/src/app/api/takehome/route.ts`:

```typescript
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // 'active', 'history', or null (all)

    let takehomes: TakehomeTest[] = []

    if (status === 'history') {
      // Get historical (completed/revoked) take-home tests
      takehomes = await takehomeManager.getHistoricalTakehomes()
    } else if (status === 'active') {
      // Get only active take-home tests
      takehomes = await takehomeManager.getActiveTakehomes()
    } else {
      // Get all take-home tests (active + historical)
      const [active, historical] = await Promise.all([
        takehomeManager.getActiveTakehomes(),
        takehomeManager.getHistoricalTakehomes(),
      ])
      takehomes = [...active, ...historical]
    }

    // Generate URLs for active tests
    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'

    const takehomesWithUrls = takehomes.map(takehome => ({
      ...takehome,
      url:
        takehome.status === 'active'
          ? `${baseUrl}/take-home/${takehome.passcode}`
          : undefined,
    }))

    return NextResponse.json({ takehomes: takehomesWithUrls })
  } catch (error: unknown) {
    console.error('Error listing take-home tests:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch take-home tests',
        details:
          process.env.NODE_ENV === 'development' && error instanceof Error
            ? error.message
            : undefined,
      },
      { status: 500 }
    )
  }
}
```

**Step 2: Test API endpoint**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/api/takehome/route.ts
git commit -m "feat: add status filtering to take-home tests GET endpoint"
```

---

## Task 10: Update TakehomeTable to Handle History Items

**Goal:** Update TakehomeTable to disable revoke action for historical items.

**Files:**

- Modify: `portal/src/components/TakehomeTable.tsx:155-175`

**Step 1: Update revoke button to check status**

In the Actions column of TakehomeTable (around line 170), update the revoke button:

```typescript
{/* Revoke Button */}
{takehome.status === 'active' && (
  <button
    onClick={() => onRevoke(takehome.passcode)}
    className="text-red-600 hover:text-red-700 text-sm font-medium"
  >
    Revoke
  </button>
)}

{/* Show status for non-active items */}
{takehome.status !== 'active' && (
  <span className="text-slate-500 text-sm">
    {takehome.status === 'completed' && 'Completed'}
    {takehome.status === 'revoked' && 'Revoked'}
    {takehome.status === 'activated' && 'In Progress'}
  </span>
)}
```

**Step 2: Verify table updates**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/TakehomeTable.tsx
git commit -m "feat: disable revoke action for historical take-home tests"
```

---

## Task 11: Update Frontend to Fetch Separate Take-Home Lists

**Goal:** Update page.tsx to fetch active and historical take-home tests separately.

**Files:**

- Modify: `portal/src/app/page.tsx:346-377` (fetchTakehomes)

**Step 1: Replace fetchTakehomes with two separate API calls**

Replace the fetchTakehomes function:

```typescript
const fetchTakehomes = async () => {
  try {
    // Fetch active take-home tests
    const activeResponse = await fetch('/api/takehome?status=active')
    if (activeResponse.ok) {
      const activeData = await activeResponse.json()
      setTakehomes(activeData.takehomes || [])
    } else {
      console.error('Failed to fetch active take-home tests')
      setTakehomes([])
    }

    // Fetch historical take-home tests
    const historyResponse = await fetch('/api/takehome?status=history')
    if (historyResponse.ok) {
      const historyData = await historyResponse.json()
      setTakehomeHistory(historyData.takehomes || [])
    } else {
      console.error('Failed to fetch take-home test history')
      setTakehomeHistory([])
    }
  } catch (error) {
    console.error('Error fetching take-home tests:', error)
    setTakehomes([])
    setTakehomeHistory([])
  }
}
```

**Step 2: Verify data fetching works**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: fetch active and historical take-home tests separately"
```

---

## Task 12: Update Take-Home Completion Logic

**Goal:** Ensure take-home tests move to history when completed or expired.

**Files:**

- Review: `portal/src/app/api/interviews/[id]/destroy/route.ts:223-243`
- Review: `portal/src/lib/takehome.ts:completeTakehome`

**Step 1: Verify completeTakehome sets status to 'completed'**

Check `portal/src/lib/takehome.ts` around line 230:

```typescript
async completeTakehome(passcode: string): Promise<boolean> {
  const command = new UpdateItemCommand({
    TableName: this.tableName,
    Key: marshall({ passcode }),
    UpdateExpression: 'SET #status = :completed',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: marshall({
      ':completed': 'completed', // ✓ Correct
    }),
  })

  await this.dynamoClient.send(command)
  return true
}
```

**Step 2: Verify destroy route calls completeTakehome**

Check `portal/src/app/api/interviews/[id]/destroy/route.ts` around line 230:

```typescript
// Check if this is a take-home interview and mark complete
if (interviewId.startsWith('takehome-')) {
  try {
    const activatedTakehomes = await takehomeManager.getActivatedTakehomes()
    const takehome = activatedTakehomes.find(t => t.interviewId === interviewId)
    if (takehome) {
      await takehomeManager.completeTakehome(takehome.passcode) // ✓ Correct
    }
  } catch (error) {
    console.error('Failed to mark take-home test as completed:', error)
  }
}
```

**Step 3: No changes needed**

This task is verification only. The existing implementation correctly marks take-home tests as 'completed'.

**Step 4: Document verification**

Run: `npm run build`

Expected: Build succeeds

---

## Task 13: Add Expiration Handling for Take-Home Tests

**Goal:** Mark take-home tests as expired when validUntil passes.

**Files:**

- Modify: `portal/src/lib/scheduler.ts:processScheduledOperations`

**Step 1: Add take-home expiration check to scheduler**

In `portal/src/lib/scheduler.ts`, after the auto-destroy processing (around line 180), add:

```typescript
// Check for expired take-home tests (validUntil has passed)
const activeTakehomes = await takehomeManager.getActiveTakehomes()
const now = new Date()

for (const takehome of activeTakehomes) {
  const validUntil = new Date(takehome.validUntil)
  if (now > validUntil) {
    logger.info(
      `[scheduler] Marking expired take-home test as revoked: ${takehome.passcode}`
    )
    await takehomeManager.revokeTakehome(takehome.passcode)
  }
}
```

**Step 2: Import takehomeManager at top of file**

Add to imports at the top of `portal/src/lib/scheduler.ts`:

```typescript
import { takehomeManager } from './takehome'
```

**Step 3: Verify scheduler compiles**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/lib/scheduler.ts
git commit -m "feat: add automatic expiration handling for take-home tests"
```

---

## Task 14: Update CLAUDE.md Documentation

**Goal:** Document the separated workflows in the project documentation.

**Files:**

- Modify: `portal/CLAUDE.md` (User Flow section)

**Step 1: Update User Flow section**

Find the "User Flow" section in `portal/CLAUDE.md` and update item 3:

```markdown
3. [x] **Create interview instances**
   1. [x] Manually create an instance immediately via "Create Interview" button
   2. [x] Schedule instance creation for future execution via "Schedule for later" checkbox
   3. [x] Select from available challenges with CPU/memory/storage display
   4. [x] **Mandatory**: Choose interview duration (30min-4hrs) with automatic destruction
   5. [x] Real-time status updates via SSE (no manual refresh needed)

3b. [X] **Create take-home tests** (Separate workflow) 1. [X] Create take-home test invitation via "Create Take-Home Test" button 2. [X] Select challenge and set availability window (1-30 days) 3. [X] Configure interview duration (1-8 hours) 4. [X] Add custom instructions for candidate 5. [X] Generate unique passcode and shareable URL 6. [X] Track active invitations in "Take-Home Tests" tab 7. [X] View completed/expired tests in "Take-Home Test History" tab
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with separated interview and take-home workflows"
```

---

## Task 15: Run Linter and Formatter

**Goal:** Ensure code quality and consistency.

**Files:**

- All modified files

**Step 1: Run Prettier**

Run: `npm run format`

Expected: All files formatted successfully

**Step 2: Run ESLint**

Run: `npm run lint`

Expected: No ESLint warnings or errors

**Step 3: Commit formatting changes if any**

```bash
git add .
git commit -m "chore: run formatter and linter"
```

---

## Task 16: Build and Verify

**Goal:** Final verification that all changes work together.

**Files:**

- All files

**Step 1: Run full build**

Run: `npm run build`

Expected: Build succeeds with no errors

**Step 2: Verify tab structure**

Check that the following tabs exist in the UI:

- Current Interviews
- Interview History
- Take-Home Tests (active invitations)
- Take-Home Test History (completed/expired/revoked)
- Admin

**Step 3: Verify button structure**

Check that two separate buttons exist:

- "Create Interview" (opens interview modal with scheduling checkbox)
- "Create Take-Home Test" (opens take-home modal)

**Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete separation of interview and take-home test workflows"
```

---

## Testing Checklist

**Manual Testing Required:**

1. **Create Interview Flow:**
   - [ ] Click "Create Interview" button
   - [ ] Verify modal opens without type selector
   - [ ] Verify "Schedule for later" checkbox exists
   - [ ] Create instant interview - should appear in "Current Interviews"
   - [ ] Create scheduled interview - should appear in "Current Interviews" with scheduled time
   - [ ] Verify interview appears in "Interview History" after completion

2. **Create Take-Home Test Flow:**
   - [ ] Click "Create Take-Home Test" button
   - [ ] Verify modal opens without type selector
   - [ ] Fill in all fields (candidate name, challenge, instructions, window, duration)
   - [ ] Create take-home test - should appear in "Take-Home Tests" tab
   - [ ] Copy URL and verify it works
   - [ ] Activate take-home test
   - [ ] Verify it moves to "Take-Home Test History" after interview completes

3. **Tab Navigation:**
   - [ ] Verify "Current Interviews" shows active interviews
   - [ ] Verify "Interview History" shows only completed interviews
   - [ ] Verify "Take-Home Tests" shows only active invitations
   - [ ] Verify "Take-Home Test History" shows completed/expired/revoked tests
   - [ ] Verify "Admin" tab still works

4. **SSE Real-time Updates:**
   - [ ] Create interview - verify it appears instantly without refresh
   - [ ] Create take-home test - verify it appears instantly without refresh
   - [ ] Complete interview - verify it moves to history without refresh

5. **Data Separation:**
   - [ ] Verify completed interviews don't appear in take-home history
   - [ ] Verify completed take-home tests don't appear in interview history
   - [ ] Verify revoked take-home tests appear in take-home history

---

## Deployment Notes

**Before Deploying:**

1. Ensure DynamoDB tables exist (interviews, operations, takehome)
2. Verify StatusIndex GSI exists on takehome table
3. Test locally with `npm run dev`
4. Run full test suite: `npm run test:all`

**After Deploying:**

1. Monitor scheduler logs for take-home expiration processing
2. Verify SSE events for both interviews and take-home tests
3. Test both create buttons in production
4. Verify data appears in correct tabs

---

## Architecture Decisions

**Why Separate Buttons?**

- Clear user intent - different workflows for different use cases
- Reduces modal complexity - each modal has single purpose
- Better UX - users don't need to select interview type

**Why Separate History Tab?**

- Take-home tests have different lifecycle than interviews
- Easier to manage and review candidate invitations
- Clearer data separation for reporting

**Why Keep Scheduling Checkbox?**

- Simple toggle - most interviews are instant
- Reduces clicks - no need to select interview type first
- Maintains backward compatibility with existing workflow

---

## Rollback Plan

If issues occur after deployment:

1. **Revert to previous commit:**

   ```bash
   git revert HEAD~16..HEAD
   git push origin main
   ```

2. **Emergency fix - disable take-home creation:**
   - Hide "Create Take-Home Test" button
   - Add feature flag check in modal render

3. **Data cleanup if needed:**
   - Take-home tests still in DynamoDB
   - Can manually query and update status
   - No data loss - just UI separation

---
