# Take-Home Real-Time Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement real-time status updates for take-home tests with unified interview table and candidate page persistence.

**Architecture:** Merge take-home records into interviews table with type field, sync operation status to interview records via SSE, update candidate page and admin dashboard with real-time displays.

**Tech Stack:** Next.js 15, TypeScript, DynamoDB, AWS SDK v3, Server-Sent Events (SSE), React hooks

---

## Task 1: Update Interview Schema and Types

**Files:**

- Modify: `portal/src/lib/interviews.ts:30-55`

**Step 1: Add type field to Interview interface**

In `portal/src/lib/interviews.ts`, update the `Interview` interface:

```typescript
export interface Interview {
  id: string
  candidateName: string
  challenge: string
  status: InterviewStatus
  type: 'regular' | 'take-home' // NEW: Differentiates interview types

  // Access details (available when status is 'active')
  accessUrl?: string
  password?: string

  // Scheduling information
  createdAt: Date
  scheduledAt?: Date // Only for regular interviews
  autoDestroyAt?: Date

  // Take-home specific fields (NEW)
  passcode?: string // 8-char code for candidate access
  validUntil?: Date // Invitation expiry
  customInstructions?: string // Additional instructions
  durationMinutes?: number // Test duration
  activatedAt?: Date // When candidate clicked "Start Test"

  // Completion information (for history)
  completedAt?: Date
  destroyedAt?: Date

  // File extraction metadata
  saveFiles?: boolean
  historyS3Key?: string

  // TTL for automatic cleanup (90 days after completion)
  ttl?: number
}
```

**Step 2: Update InterviewDynamoItem interface**

```typescript
interface InterviewDynamoItem {
  id: string
  candidateName: string
  challenge: string
  status: InterviewStatus
  type: 'regular' | 'take-home' // NEW
  accessUrl?: string
  password?: string

  // Timestamps stored as Unix seconds in DynamoDB
  createdAt: number
  scheduledAt?: number
  autoDestroyAt?: number

  // Take-home specific (NEW)
  passcode?: string
  validUntil?: number
  customInstructions?: string
  durationMinutes?: number
  activatedAt?: number

  completedAt?: number
  destroyedAt?: number

  saveFiles?: boolean
  historyS3Key?: string
  ttl?: number
}
```

**Step 3: Commit schema changes**

```bash
git add portal/src/lib/interviews.ts
git commit -m "feat: add take-home fields to Interview schema"
```

---

## Task 2: Add DynamoDB Indexes for Take-Home

**Files:**

- Modify: `infra/dynamodb.tf:1-50`

**Step 1: Add PasscodeIndex GSI**

In `infra/dynamodb.tf`, add a new GSI to the interviews table:

```hcl
resource "aws_dynamodb_table" "interviews" {
  # ... existing configuration ...

  # Existing GSI
  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # NEW: Passcode lookup for take-home tests
  global_secondary_index {
    name            = "PasscodeIndex"
    hash_key        = "passcode"
    projection_type = "ALL"
  }

  # NEW: Filter by type and status
  global_secondary_index {
    name            = "TypeStatusIndex"
    hash_key        = "type"
    range_key       = "status"
    projection_type = "ALL"
  }
}
```

**Step 2: Commit infrastructure changes**

```bash
git add infra/dynamodb.tf
git commit -m "infra: add PasscodeIndex and TypeStatusIndex to interviews table"
```

**Note:** Infrastructure changes require `terraform apply` to take effect. Run this in the infra directory when ready.

---

## Task 3: Add getInterviewByPasscode Method

**Files:**

- Modify: `portal/src/lib/interviews.ts:150-200`

**Step 1: Add getInterviewByPasscode method to InterviewManager**

Add this method after the existing `getInterview` method:

```typescript
/**
 * Gets an interview by passcode (for take-home tests).
 *
 * @param passcode - The 8-character passcode
 * @returns Interview object or null if not found
 */
async getInterviewByPasscode(passcode: string): Promise<Interview | null> {
  try {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'PasscodeIndex',
      KeyConditionExpression: 'passcode = :passcode',
      ExpressionAttributeValues: marshall({
        ':passcode': passcode,
      }),
      Limit: 1,
    })

    const response = await this.dynamoClient.send(command)

    if (!response.Items || response.Items.length === 0) {
      return null
    }

    const item = unmarshall(response.Items[0]) as InterviewDynamoItem

    return {
      id: item.id,
      candidateName: item.candidateName,
      challenge: item.challenge,
      status: item.status,
      type: item.type,
      accessUrl: item.accessUrl,
      password: item.password,
      createdAt: new Date(item.createdAt * 1000),
      scheduledAt: item.scheduledAt
        ? new Date(item.scheduledAt * 1000)
        : undefined,
      autoDestroyAt: item.autoDestroyAt
        ? new Date(item.autoDestroyAt * 1000)
        : undefined,
      passcode: item.passcode,
      validUntil: item.validUntil
        ? new Date(item.validUntil * 1000)
        : undefined,
      customInstructions: item.customInstructions,
      durationMinutes: item.durationMinutes,
      activatedAt: item.activatedAt
        ? new Date(item.activatedAt * 1000)
        : undefined,
      completedAt: item.completedAt
        ? new Date(item.completedAt * 1000)
        : undefined,
      destroyedAt: item.destroyedAt
        ? new Date(item.destroyedAt * 1000)
        : undefined,
      saveFiles: item.saveFiles,
      historyS3Key: item.historyS3Key,
      ttl: item.ttl,
    }
  } catch (error) {
    console.error('Error getting interview by passcode:', error)
    return null
  }
}
```

**Step 2: Commit the new method**

```bash
git add portal/src/lib/interviews.ts
git commit -m "feat: add getInterviewByPasscode method to InterviewManager"
```

---

## Task 4: Update createInterview to Support Take-Home Type

**Files:**

- Modify: `portal/src/lib/interviews.ts:100-150`

**Step 1: Update createInterview method signature and implementation**

Modify the `createInterview` method to handle take-home specific fields:

```typescript
/**
 * Creates a new interview in DynamoDB.
 */
async createInterview(interview: {
  id: string
  candidateName: string
  challenge: string
  type?: 'regular' | 'take-home' // NEW: defaults to 'regular'
  scheduledAt?: Date
  autoDestroyAt?: Date
  saveFiles?: boolean
  passcode?: string // NEW: for take-home
  validUntil?: Date // NEW: for take-home
  customInstructions?: string // NEW: for take-home
  durationMinutes?: number // NEW: for take-home
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000)

  const item: InterviewDynamoItem = {
    id: interview.id,
    candidateName: interview.candidateName,
    challenge: interview.challenge,
    status: 'scheduled',
    type: interview.type || 'regular', // NEW
    createdAt: now,
    scheduledAt: interview.scheduledAt
      ? Math.floor(interview.scheduledAt.getTime() / 1000)
      : undefined,
    autoDestroyAt: interview.autoDestroyAt
      ? Math.floor(interview.autoDestroyAt.getTime() / 1000)
      : undefined,
    saveFiles: interview.saveFiles,
    // NEW: Take-home fields
    passcode: interview.passcode,
    validUntil: interview.validUntil
      ? Math.floor(interview.validUntil.getTime() / 1000)
      : undefined,
    customInstructions: interview.customInstructions,
    durationMinutes: interview.durationMinutes,
  }

  await this.dynamoClient.send(
    new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  )
}
```

**Step 2: Commit the update**

```bash
git add portal/src/lib/interviews.ts
git commit -m "feat: update createInterview to support take-home type"
```

---

## Task 5: Add Operation-to-Interview Status Sync

**Files:**

- Modify: `portal/src/lib/operations.ts:700-800`

**Step 1: Add syncInterviewStatus method to OperationManager**

Add this method to the `OperationManager` class:

```typescript
/**
 * Syncs interview status based on operation status.
 * Called automatically when operation status changes.
 */
private async syncInterviewStatus(operation: Operation): Promise<void> {
  if (!operation.interviewId) return

  const statusMap: Record<Operation['status'], InterviewStatus> = {
    pending: 'scheduled',
    running: 'initializing',
    completed: 'active',
    failed: 'error',
    cancelled: 'error',
    scheduled: 'scheduled',
  }

  const interviewStatus = statusMap[operation.status]
  if (!interviewStatus) return

  try {
    await interviewManager.updateInterviewStatus(
      operation.interviewId,
      interviewStatus,
      {
        accessUrl: operation.result?.accessUrl,
        password: operation.result?.password,
      }
    )
  } catch (error) {
    console.error('Error syncing interview status:', error)
  }
}
```

**Step 2: Call syncInterviewStatus in setOperationResult**

Modify the `setOperationResult` method to call the sync:

```typescript
async setOperationResult(
  operationId: string,
  result: {
    success: boolean
    accessUrl?: string
    password?: string
    error?: string
    fullOutput?: string
    healthCheckPassed?: boolean
    infrastructureReady?: boolean
    historyS3Key?: string
  }
): Promise<void> {
  const operation = await this.getOperation(operationId)
  if (!operation) return

  const status = result.success ? 'completed' : 'failed'
  const updatedOperation: Operation = {
    ...operation,
    status,
    result,
    completedAt: new Date(),
  }

  await this.saveOperation(updatedOperation)

  // NEW: Sync interview status
  await this.syncInterviewStatus(updatedOperation)

  this.emit(updatedOperation)
}
```

**Step 3: Commit status sync functionality**

```bash
git add portal/src/lib/operations.ts
git commit -m "feat: add operation-to-interview status sync"
```

---

## Task 6: Create API Endpoint for Passcode Lookup

**Files:**

- Create: `portal/src/app/api/interviews/by-passcode/[passcode]/route.ts`

**Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'

/**
 * Gets an interview by passcode (for take-home tests).
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response with interview data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    const interview = await interviewManager.getInterviewByPasscode(passcode)

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      )
    }

    // Validate it's a take-home test
    if (interview.type !== 'take-home') {
      return NextResponse.json(
        { error: 'Not a take-home test' },
        { status: 400 }
      )
    }

    return NextResponse.json(interview)
  } catch (error) {
    console.error('Error getting interview by passcode:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 2: Commit the new endpoint**

```bash
git add portal/src/app/api/interviews/by-passcode/[passcode]/route.ts
git commit -m "feat: add API endpoint for passcode lookup"
```

---

## Task 7: Create Interview Activation Endpoint

**Files:**

- Create: `portal/src/app/api/interviews/[id]/activate/route.ts`

**Step 1: Create the activation route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * Activates a take-home test and starts interview provisioning.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with interview ID
 * @returns JSON response with operation ID
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get interview
    const interview = await interviewManager.getInterview(id)
    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      )
    }

    // Validate it's a take-home test
    if (interview.type !== 'take-home') {
      return NextResponse.json(
        { error: 'Not a take-home test' },
        { status: 400 }
      )
    }

    // Validate status
    if (interview.status !== 'scheduled') {
      return NextResponse.json(
        {
          error:
            interview.status === 'activated'
              ? 'This take-home test has already been started'
              : interview.status === 'completed'
                ? 'This take-home test has been completed'
                : 'This take-home test is no longer available',
        },
        { status: 400 }
      )
    }

    // Validate expiry
    if (interview.validUntil && new Date() > interview.validUntil) {
      return NextResponse.json(
        { error: 'This take-home test invitation has expired' },
        { status: 400 }
      )
    }

    // Generate password
    const password = Math.random().toString(36).substring(2, 12)

    // Calculate auto-destroy time
    const autoDestroyDate = new Date(
      Date.now() + (interview.durationMinutes || 240) * 60 * 1000
    )

    // Update interview to activated status
    await interviewManager.updateInterviewStatus(id, 'activated', {
      activatedAt: new Date(),
      autoDestroyAt: autoDestroyDate,
    })

    // Create operation for interview creation
    const operationId = await operationManager.createOperation(
      'create',
      id,
      interview.candidateName,
      interview.challenge,
      undefined, // No scheduled time
      autoDestroyDate,
      true // Always save files for take-home tests
    )

    const instance = {
      id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      password,
    }

    // Start background provisioning
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Starting take-home interview for ${interview.candidateName}`
        )

        const result = await interviewManager.createInterviewWithInfrastructure(
          instance,
          (data: string) => {
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              operationManager
                .addOperationLog(operationId, line)
                .catch(console.error)
            })
          },
          (accessUrl: string) => {
            operationManager
              .updateOperationInfrastructureReady(
                operationId,
                accessUrl,
                password
              )
              .catch(console.error)
            operationManager
              .addOperationLog(
                operationId,
                '🔧 Infrastructure ready, ECS service starting up...'
              )
              .catch(console.error)
          },
          undefined,
          autoDestroyDate,
          true
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Take-home interview created successfully!'
          )

          await operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: password,
            fullOutput: result.fullOutput,
            healthCheckPassed: result.healthCheckPassed,
            infrastructureReady: result.infrastructureReady,
          })
        } else {
          await operationManager.addOperationLog(
            operationId,
            '❌ Take-home interview creation failed'
          )

          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput,
          })
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg,
        })
      }
    })

    return NextResponse.json({
      success: true,
      operationId,
      interviewId: id,
    })
  } catch (error) {
    console.error('Error activating take-home test:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 2: Commit the activation endpoint**

```bash
git add portal/src/app/api/interviews/[id]/activate/route.ts
git commit -m "feat: add interview activation endpoint for take-home tests"
```

---

## Task 8: Update Take-Home Creation API

**Files:**

- Modify: `portal/src/app/api/takehome/route.ts:20-80`

**Step 1: Update POST handler to create unified interview**

Replace the take-home creation logic with interview creation:

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate required fields
    if (!body.candidateName || !body.challenge) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Generate passcode and ID
    const passcode = Math.random().toString(36).substring(2, 10).toUpperCase()
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 7)
    const interviewId = `takehome-${timestamp}-${random}`

    // Calculate validity period
    const validDays = body.validDays || 7
    const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)

    // Create interview record (not operation yet)
    await interviewManager.createInterview({
      id: interviewId,
      candidateName: body.candidateName,
      challenge: body.challenge,
      type: 'take-home',
      passcode,
      validUntil,
      customInstructions: body.customInstructions || '',
      durationMinutes: body.durationMinutes || 240,
      saveFiles: true,
    })

    // Generate URL for candidate
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const url = `${baseUrl}/take-home/${passcode}`

    return NextResponse.json({
      success: true,
      interview: {
        id: interviewId,
        passcode,
        url,
        validUntil: validUntil.toISOString(),
      },
    })
  } catch (error) {
    console.error('Error creating take-home test:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 2: Commit the updated API**

```bash
git add portal/src/app/api/takehome/route.ts
git commit -m "feat: update take-home creation to use unified interview table"
```

---

## Task 9: Update Candidate Page with Real-Time Status

**Files:**

- Modify: `portal/src/app/take-home/[passcode]/page.tsx:1-200`

**Step 1: Add SSE integration and status display**

Replace the entire file content:

```typescript
'use client'

import { use, useEffect, useState } from 'react'
import { useSSE } from '@/hooks/useSSE'

interface Interview {
  id: string
  passcode: string
  candidateName: string
  challenge: string
  customInstructions?: string
  status: string
  validUntil: string
  durationMinutes: number
  accessUrl?: string
  password?: string
  autoDestroyAt?: string
}

export default function TakeHomePage({
  params,
}: {
  params: Promise<{ passcode: string }>
}) {
  const { passcode } = use(params)
  const [interview, setInterview] = useState<Interview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const { lastEvent } = useSSE('/api/events')

  const fetchInterview = async () => {
    try {
      const response = await fetch(`/api/interviews/by-passcode/${passcode}`)
      if (response.ok) {
        const data = await response.json()
        setInterview(data)
      } else {
        const data = await response.json()
        setError(data.error || 'Interview not found')
      }
    } catch {
      setError('Failed to load interview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInterview()
  }, [passcode])

  // SSE updates
  useEffect(() => {
    if (lastEvent?.type === 'operation_update' && interview) {
      const op = lastEvent.operation
      if (op.interviewId === interview.id) {
        fetchInterview()
      }
    }
  }, [lastEvent, interview?.id])

  const handleStart = async () => {
    if (!interview) return

    setActivating(true)
    setError(null)

    try {
      const response = await fetch(`/api/interviews/${interview.id}/activate`, {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        // Refresh interview to get activated status
        await fetchInterview()
        setActivating(false)
      } else {
        setError(data.error || 'Failed to start test')
        setActivating(false)
      }
    } catch {
      setError('Failed to start test. Please try again.')
      setActivating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-slate-600">Loading...</div>
        </div>
      </div>
    )
  }

  if (error || !interview) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <div className="text-red-600 text-xl font-semibold mb-4">Error</div>
          <div className="text-slate-700">{error || 'Invalid invitation'}</div>
        </div>
      </div>
    )
  }

  const validUntil = new Date(interview.validUntil)
  const isExpired = new Date() > validUntil
  const isNotStarted = interview.status === 'scheduled'
  const isProvisioning =
    interview.status === 'activated' ||
    interview.status === 'initializing' ||
    interview.status === 'configuring'
  const isReady = interview.status === 'active' && interview.accessUrl
  const isCompleted = interview.status === 'completed'

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">
              Take-Home Test: {interview.candidateName}
            </h1>
            <div className="text-slate-600">
              Challenge: <span className="font-semibold">{interview.challenge}</span>
            </div>
            <div className="text-sm text-slate-500 mt-2">
              Valid until: {validUntil.toLocaleString()}
            </div>
          </div>

          {/* Not Started State */}
          {isNotStarted && !isExpired && (
            <>
              {/* Platform Instructions */}
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-blue-900 mb-3">
                  Platform Instructions
                </h2>
                <ul className="space-y-2 text-blue-800 text-sm">
                  <li>• Click "Start Test" to begin provisioning your workspace</li>
                  <li>• Your workspace will be ready in approximately 3-5 minutes</li>
                  <li>
                    • You will have {interview.durationMinutes} minutes to complete the
                    challenge
                  </li>
                  <li>
                    • Once your workspace is created, it will automatically shut down
                    after {interview.durationMinutes} minutes
                  </li>
                  <li>• All your work will be automatically saved</li>
                  <li>• You can only start this test once</li>
                </ul>
              </div>

              {/* Custom Instructions */}
              {interview.customInstructions && (
                <div className="mb-6 bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-slate-800 mb-3">
                    Challenge Instructions
                  </h2>
                  <div className="text-slate-700 whitespace-pre-wrap text-sm">
                    {interview.customInstructions}
                  </div>
                </div>
              )}

              {/* Start Button */}
              <div className="mt-8">
                <button
                  onClick={handleStart}
                  disabled={activating}
                  className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-colors ${
                    activating
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {activating ? 'Starting...' : 'Start Test'}
                </button>

                {activating && (
                  <div className="mt-4 text-center text-sm text-slate-600">
                    Starting your test...
                  </div>
                )}
              </div>
            </>
          )}

          {/* Provisioning State */}
          {isProvisioning && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="animate-spin h-6 w-6 border-3 border-blue-500 border-t-transparent rounded-full" />
                <h2 className="text-lg font-semibold text-blue-900">
                  {interview.status === 'activated' && 'Starting your workspace...'}
                  {interview.status === 'initializing' &&
                    'Provisioning infrastructure...'}
                  {interview.status === 'configuring' &&
                    'Setting up your development environment...'}
                </h2>
              </div>
              <p className="text-blue-800 text-sm mb-3">
                This will take approximately 3-5 minutes. Please wait...
              </p>
              <div className="text-xs text-blue-700">
                You can safely close this page and return later. Your workspace will be
                ready when you come back.
              </div>
            </div>
          )}

          {/* Ready State */}
          {isReady && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4">
                Your Workspace is Ready!
              </h2>

              <div className="bg-white rounded-lg p-4 mb-4">
                <div className="mb-3">
                  <label className="text-sm font-semibold text-slate-700 block mb-1">
                    VS Code URL:
                  </label>
                  <a
                    href={interview.accessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline text-sm break-all"
                  >
                    {interview.accessUrl}
                  </a>
                </div>

                <div className="mb-3">
                  <label className="text-sm font-semibold text-slate-700 block mb-1">
                    Password:
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="bg-slate-100 px-3 py-2 rounded text-sm font-mono flex-1">
                      {interview.password}
                    </code>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(interview.password || '')
                      }
                      className="px-3 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {interview.autoDestroyAt && (
                  <div className="text-sm text-slate-600 mt-3">
                    ⏰ Time remaining:{' '}
                    <span className="font-semibold">
                      {Math.max(
                        0,
                        Math.floor(
                          (new Date(interview.autoDestroyAt).getTime() -
                            Date.now()) /
                            60000
                        )
                      )}{' '}
                      minutes
                    </span>
                  </div>
                )}
              </div>

              <a
                href={interview.accessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-4 px-6 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-lg text-center transition-colors"
              >
                Open Workspace
              </a>
            </div>
          )}

          {/* Expired State */}
          {isExpired && isNotStarted && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              This invitation has expired
            </div>
          )}

          {/* Completed State */}
          {isCompleted && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-slate-700">
              This test has been completed
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Run formatter**

```bash
npm run format
```

**Step 3: Commit the updated candidate page**

```bash
git add portal/src/app/take-home/[passcode]/page.tsx
git commit -m "feat: add real-time status updates to candidate take-home page"
```

---

## Task 10: Update Admin Dashboard Take-Home Tab

**Files:**

- Modify: `portal/src/app/page.tsx:1750-1790`

**Step 1: Update Take-Home Tests tab to filter by type**

Find the "Take-Home Tests Tab" section and update the data loading:

```typescript
// Around line 1754
{/* Take-Home Tests Tab */}
{activeTab === 'takehome' && (
  <div className="card overflow-hidden">
    <TakehomeTable
      takehomes={interviews.filter(
        i => i.type === 'take-home' && i.status !== 'completed'
      )}
      challenges={challenges}
      onRevoke={async (id: string) => {
        // Destroy the interview
        try {
          setLoading(true)
          await destroyInterview(id, false)
          setNotification('✅ Take-home test revoked successfully')
          setTimeout(() => setNotification(null), 5000)
          loadInterviews()
        } catch (error) {
          console.error('Error revoking take-home:', error)
          setNotification('❌ Failed to revoke take-home test')
          setTimeout(() => setNotification(null), 5000)
        } finally {
          setLoading(false)
        }
      }}
    />
  </div>
)}
```

**Step 2: Update Take-Home History tab**

```typescript
{/* Take-Home Test History Tab */}
{activeTab === 'takehomeHistory' && (
  <div className="card overflow-hidden">
    {interviews.filter(i => i.type === 'take-home' && i.status === 'completed')
      .length === 0 ? (
      <div className="p-6 sm:p-8 text-center text-slate-500">
        <p className="text-lg">No take-home test history yet</p>
        <p className="text-sm mt-2">
          Completed, expired, or revoked take-home tests will appear here
        </p>
      </div>
    ) : (
      <TakehomeTable
        takehomes={interviews.filter(
          i => i.type === 'take-home' && i.status === 'completed'
        )}
        challenges={challenges}
        onRevoke={async () => {
          console.log('Cannot revoke historical take-home test')
        }}
      />
    )}
  </div>
)}
```

**Step 3: Commit dashboard updates**

```bash
git add portal/src/app/page.tsx
git commit -m "feat: update admin dashboard to show take-homes from unified table"
```

---

## Task 11: Update TakehomeTable Component

**Files:**

- Modify: `portal/src/components/TakehomeTable.tsx:5-238`

**Step 1: Update interface to accept Interview type**

Replace the `Takehome` interface with `Interview` type:

```typescript
'use client'

import React, { useState } from 'react'

interface Interview {
  id: string
  passcode?: string
  candidateName: string
  challenge: string
  customInstructions?: string
  status: string
  validUntil?: string
  durationMinutes?: number
  accessUrl?: string
  password?: string
  autoDestroyAt?: string
  createdAt: string
  activatedAt?: string
  type: 'regular' | 'take-home'
}

interface Challenge {
  id: string
  name: string
}

interface TakehomeTableProps {
  takehomes: Interview[]
  challenges: Challenge[]
  onRevoke: (id: string) => void
}

export function TakehomeTable({
  takehomes,
  challenges,
  onRevoke,
}: TakehomeTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const getStatusBadge = (status: string, hasAccessUrl: boolean) => {
    if (status === 'scheduled') {
      return (
        <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
          Available
        </span>
      )
    }
    if (status === 'activated') {
      return (
        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
          Activated
        </span>
      )
    }
    if (status === 'initializing') {
      return (
        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
          Provisioning
        </span>
      )
    }
    if (status === 'configuring') {
      return (
        <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-semibold">
          Configuring
        </span>
      )
    }
    if (status === 'active' && hasAccessUrl) {
      return (
        <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
          Running
        </span>
      )
    }
    if (status === 'completed') {
      return (
        <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">
          Completed
        </span>
      )
    }
    if (status === 'error') {
      return (
        <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">
          Error
        </span>
      )
    }
    return (
      <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">
        {status}
      </span>
    )
  }

  if (takehomes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        No take-home tests created yet
      </div>
    )
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-100 border-b border-slate-200">
          <tr>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Candidate
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Challenge
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              URL
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Status
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Valid Until
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {takehomes.map(takehome => {
            const validUntil = takehome.validUntil
              ? new Date(takehome.validUntil)
              : null
            const isExpired = validUntil ? new Date() > validUntil : false
            const isExpanded = expandedRow === takehome.id
            const url = takehome.passcode
              ? `${baseUrl}/take-home/${takehome.passcode}`
              : ''

            return (
              <React.Fragment key={takehome.id}>
                <tr className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800">
                    {takehome.candidateName}
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {challenges.find(c => c.id === takehome.challenge)?.name ||
                      takehome.challenge}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm break-all underline"
                      >
                        {url}
                      </a>
                      <button
                        onClick={() => copyToClipboard(url, takehome.id)}
                        className="text-sm px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded flex-shrink-0"
                        title="Copy URL"
                      >
                        {copiedId === takehome.id ? '✓' : '📋'}
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="space-y-2">
                      {getStatusBadge(takehome.status, !!takehome.accessUrl)}

                      {/* Show access details when ready */}
                      {takehome.accessUrl && (
                        <div className="text-xs text-slate-600 space-y-1">
                          <div className="truncate">
                            URL: {takehome.accessUrl}
                          </div>
                          <div>Password: {takehome.password}</div>
                          {takehome.autoDestroyAt && (
                            <div>
                              Time remaining:{' '}
                              {Math.max(
                                0,
                                Math.floor(
                                  (new Date(takehome.autoDestroyAt).getTime() -
                                    Date.now()) /
                                    60000
                                )
                              )}{' '}
                              min
                            </div>
                          )}
                        </div>
                      )}

                      {/* Show progress when provisioning */}
                      {(takehome.status === 'activated' ||
                        takehome.status === 'initializing' ||
                        takehome.status === 'configuring') && (
                        <div className="text-xs text-slate-600 flex items-center gap-2">
                          <div className="animate-spin h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full" />
                          <span>Provisioning workspace...</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {validUntil ? (
                      isExpired ? (
                        <span className="text-red-600">Expired</span>
                      ) : (
                        validUntil.toLocaleString()
                      )
                    ) : (
                      'N/A'
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      {takehome.status !== 'completed' && (
                        <button
                          onClick={() => onRevoke(takehome.id)}
                          className="text-sm px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                        >
                          Revoke
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setExpandedRow(isExpanded ? null : takehome.id)
                        }
                        className="text-sm px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="py-4 px-6">
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-700 mb-1">
                            Passcode:
                          </div>
                          <div className="text-sm text-slate-900">
                            <code className="bg-slate-100 px-2 py-1 rounded font-mono">
                              {takehome.passcode}
                            </code>
                          </div>
                        </div>
                        {takehome.customInstructions && (
                          <div>
                            <div className="text-sm font-semibold text-slate-700 mb-1">
                              Custom Instructions:
                            </div>
                            <div className="text-sm text-slate-600 whitespace-pre-wrap">
                              {takehome.customInstructions}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-700">
                              Duration:
                            </div>
                            <div className="text-sm text-slate-600">
                              {takehome.durationMinutes} minutes
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-700">
                              Created:
                            </div>
                            <div className="text-sm text-slate-600">
                              {new Date(takehome.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {takehome.activatedAt && (
                            <div>
                              <div className="text-sm font-semibold text-slate-700">
                                Activated:
                              </div>
                              <div className="text-sm text-slate-600">
                                {new Date(takehome.activatedAt).toLocaleString()}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

**Step 2: Run formatter**

```bash
npm run format
```

**Step 3: Commit the updated component**

```bash
git add portal/src/components/TakehomeTable.tsx
git commit -m "feat: update TakehomeTable to work with unified interview records"
```

---

## Task 12: Update Interview Loading Logic

**Files:**

- Modify: `portal/src/app/page.tsx:350-410`

**Step 1: Update loadInterviews to include take-home tests**

The existing `loadInterviews` function should already load all interviews. We just need to ensure it's used correctly. Verify the function around line 350:

```typescript
const loadInterviews = useCallback(async () => {
  try {
    const timestamp = new Date().getTime()
    const response = await fetch(`/api/interviews?t=${timestamp}`)
    if (response.ok) {
      const data = await response.json()
      const newInterviews = data.interviews || []
      setInterviews(newInterviews) // This now includes type='take-home' records
    } else {
      console.error('Failed to load current interviews')
    }

    if (initialLoading) {
      setInitialLoading(false)
    }
  }
}, [initialLoading])
```

No changes needed if the function already exists as above. The unified table means take-home tests are automatically included.

**Step 2: Verify SSE updates trigger refresh**

Ensure SSE events trigger interview refresh (should already exist around line 580):

```typescript
useEffect(() => {
  if (lastEvent?.type === 'operation_update') {
    console.log('Refreshing interviews from API due to SSE event')
    setTimeout(() => {
      loadInterviews()
    }, 100)
  }
}, [lastEvent])
```

**Step 3: Commit if any changes made**

```bash
git add portal/src/app/page.tsx
git commit -m "feat: ensure interview loading includes take-home tests"
```

---

## Task 13: Add Logs Button for Take-Home Tests

**Files:**

- Modify: `portal/src/components/TakehomeTable.tsx:200-210`

**Step 1: Add Logs button to Actions column**

Update the Actions column to include a Logs button:

```typescript
<td className="py-3 px-4">
  <div className="flex gap-2">
    {/* Logs button - show for all statuses */}
    <button
      onClick={() => {
        // Trigger logs modal from parent
        const event = new CustomEvent('openLogs', {
          detail: { interviewId: takehome.id },
        })
        window.dispatchEvent(event)
      }}
      className="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded"
    >
      Logs
    </button>

    {takehome.status !== 'completed' && (
      <button
        onClick={() => onRevoke(takehome.id)}
        className="text-sm px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
      >
        Revoke
      </button>
    )}

    <button
      onClick={() =>
        setExpandedRow(isExpanded ? null : takehome.id)
      }
      className="text-sm px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
    >
      {isExpanded ? 'Hide' : 'Details'}
    </button>
  </div>
</td>
```

**Step 2: Update parent component to listen for logs event**

In `portal/src/app/page.tsx`, add event listener (around line 600):

```typescript
useEffect(() => {
  const handleOpenLogs = (e: CustomEvent) => {
    setSelectedInterviewForLogs(e.detail.interviewId)
    setShowLogsModal(true)
  }

  window.addEventListener('openLogs', handleOpenLogs as EventListener)
  return () => {
    window.removeEventListener('openLogs', handleOpenLogs as EventListener)
  }
}, [])
```

**Step 3: Commit logs functionality**

```bash
git add portal/src/components/TakehomeTable.tsx portal/src/app/page.tsx
git commit -m "feat: add Logs button to take-home tests table"
```

---

## Task 14: Run Tests and Fix Issues

**Files:**

- Various test files

**Step 1: Run unit tests**

```bash
cd portal
npm run test
```

Expected: Some tests may fail due to schema changes. Review failures.

**Step 2: Update failing tests**

For each failing test related to Interview schema:

- Add `type: 'regular'` to mock interview data
- Update interface expectations

Example fix in test files:

```typescript
const mockInterview: Interview = {
  id: 'test-id',
  candidateName: 'Test',
  challenge: 'test',
  status: 'active',
  type: 'regular', // NEW
  createdAt: new Date(),
  // ... rest of fields
}
```

**Step 3: Run tests again**

```bash
npm run test
```

Expected: All tests pass.

**Step 4: Commit test fixes**

```bash
git add portal/src/**/__tests__/**
git commit -m "test: update tests for unified interview schema"
```

---

## Task 15: Run Linter and Formatter

**Files:**

- All modified files

**Step 1: Run ESLint**

```bash
cd portal
npm run lint
```

Expected: No errors. Fix any linting issues if they appear.

**Step 2: Run Prettier**

```bash
npm run format
```

Expected: Code formatted consistently.

**Step 3: Commit any formatting changes**

```bash
git add -A
git commit -m "style: run linter and formatter"
```

---

## Task 16: Manual Testing - Create Take-Home Test

**Files:**

- N/A (manual testing)

**Step 1: Start dev server**

```bash
cd portal
npm run dev
```

**Step 2: Create a take-home test**

1. Navigate to http://localhost:3000
2. Login (if auth enabled)
3. Click "Create Take-Home Test"
4. Fill in:
   - Candidate Name: "Test Candidate"
   - Challenge: Select any challenge
   - Valid Days: 7
   - Duration: 240 minutes
   - Custom Instructions: "Complete all exercises"
5. Click "Create Take-Home"

**Step 3: Verify take-home appears in table**

Expected:

- Take-home appears in "Take-Home Tests" tab
- Status shows "Available" (green badge)
- URL shows `/take-home/[PASSCODE]`
- Copy URL button works

---

## Task 17: Manual Testing - Activate Take-Home

**Files:**

- N/A (manual testing)

**Step 1: Copy take-home URL**

From the "Take-Home Tests" tab, click copy URL button.

**Step 2: Open take-home page in new incognito window**

1. Open incognito window
2. Paste URL: http://localhost:3000/take-home/[PASSCODE]

Expected:

- Page loads with instructions
- Shows "Start Test" button
- Shows custom instructions

**Step 3: Click "Start Test"**

Expected:

- Button shows "Starting..."
- Page updates to show provisioning status
- Status badge appears: "Activated" → "Provisioning" → "Configuring"

**Step 4: Wait for workspace to be ready (3-5 minutes)**

Expected:

- Real-time status updates without refresh
- Progress indicator shows
- When ready: Access card appears with URL and password

**Step 5: Verify admin dashboard updates**

In the main portal window:

Expected:

- Take-home status updates in real-time
- Shows "Provisioning" → "Configuring" → "Running"
- Access details appear inline
- Take-home stays in "Take-Home Tests" tab (does NOT move to "Current Interviews")

---

## Task 18: Manual Testing - Page Refresh

**Files:**

- N/A (manual testing)

**Step 1: Close candidate page during provisioning**

While workspace is provisioning, close the take-home page tab.

**Step 2: Reopen the same URL**

Open http://localhost:3000/take-home/[PASSCODE] again.

Expected:

- Page loads and shows current status
- If still provisioning: Shows progress
- If ready: Shows access details immediately

---

## Task 19: Manual Testing - Logs Button

**Files:**

- N/A (manual testing)

**Step 1: Click "Logs" button in take-home table**

From "Take-Home Tests" tab, click "Logs" button.

Expected:

- Operation logs modal opens
- Shows real-time provisioning logs
- Logs stream as operation progresses

**Step 2: Verify logs content**

Expected logs to include:

- "Starting take-home interview for [Name]"
- Terraform output
- "Infrastructure ready..."
- "✅ Take-home interview created successfully!"

---

## Task 20: Update CLAUDE.md Documentation

**Files:**

- Modify: `portal/CLAUDE.md:1-100`

**Step 1: Add take-home information to documentation**

Add a new section after the "Take-Home Test Management" section:

```markdown
## Take-Home Test Architecture

**Unified Data Model:**
Take-home tests are stored in the same `interviews` DynamoDB table as regular interviews, differentiated by the `type` field:

- `type: 'regular'` - Standard interviews created by admins
- `type: 'take-home'` - Tests with passcode-based candidate access

**Key Fields for Take-Home:**

- `passcode`: 8-character code for candidate access URL
- `validUntil`: Invitation expiration date
- `customInstructions`: Additional instructions for candidates
- `durationMinutes`: Test duration (auto-destroy timer)
- `activatedAt`: Timestamp when candidate clicked "Start Test"

**Status Flow:**

1. Created: `status='scheduled'` (invitation available)
2. Activated: `status='activated'` (candidate clicked start)
3. Provisioning: `status='initializing'` → `status='configuring'`
4. Running: `status='active'` with accessUrl/password
5. Completed: `status='completed'`

**Real-Time Updates:**

- Operations auto-sync status to interview records
- SSE events trigger UI updates on both candidate and admin pages
- Candidate page shows live provisioning progress
- Admin dashboard shows inline access details and status

**Candidate Experience:**

- Access via `/take-home/[passcode]` (no login required)
- Real-time provisioning progress
- Access details displayed when ready
- Page refresh safe (status persists)
- Never sees admin portal

**Admin Experience:**

- Take-homes stay in "Take-Home Tests" tab
- Real-time status updates via SSE
- Inline access details display
- Logs button for troubleshooting
- Revoke button to cancel/destroy
```

**Step 2: Commit documentation**

```bash
git add portal/CLAUDE.md
git commit -m "docs: add take-home test architecture to CLAUDE.md"
```

---

## Task 21: Final Build and Verification

**Files:**

- N/A (build verification)

**Step 1: Build the project**

```bash
cd portal
npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Run the production build**

```bash
npm start
```

Expected: Server starts successfully.

**Step 3: Quick smoke test**

1. Navigate to http://localhost:3000
2. Create a take-home test
3. Open candidate page
4. Verify page loads correctly

**Step 4: Stop the server**

Press Ctrl+C to stop.

---

## Task 22: Final Commit and Push

**Files:**

- All modified files

**Step 1: Review all changes**

```bash
git status
git diff
```

**Step 2: Create final commit if needed**

```bash
git add -A
git commit -m "feat: complete take-home real-time flow implementation"
```

**Step 3: Push to remote**

```bash
git push origin feature/take-home-tests
```

---

## Success Criteria

✅ Take-home tests stored in unified interviews table with `type` field
✅ Candidate stays on `/take-home/[passcode]` page throughout lifecycle
✅ Real-time status updates via SSE (no polling)
✅ Candidate page shows progress: Initializing → Configuring → Active
✅ Access details (URL/password) displayed when ready
✅ Page refresh safe - status persists
✅ Take-homes stay in "Take-Home Tests" tab (never move to "Current Interviews")
✅ Admin sees real-time status updates via SSE
✅ Inline access details in admin dashboard
✅ Logs button works for take-home tests
✅ Revoke button destroys running instance
✅ All tests pass
✅ Build succeeds
✅ Documentation updated

---

## Notes

- This implementation maintains backward compatibility by keeping the old takehome table
- The unified schema is additive - doesn't break existing regular interviews
- SSE provides real-time updates without polling overhead
- Status sync ensures consistent state across operations and interviews
- Candidate page is completely isolated from admin portal (no auth required)
