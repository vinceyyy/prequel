# Take-Home Test Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add take-home test functionality allowing managers to create time-windowed interview invitations that candidates can self-activate via passcode.

**Architecture:** Extends existing interview system with new DynamoDB table for take-home metadata, new Next.js route for candidate access, rate limiting middleware, and enhanced create modal. Reuses existing operation system for instance provisioning and destruction.

**Tech Stack:** Next.js 15 App Router, TypeScript, DynamoDB, AWS SDK v3, Tailwind CSS, Server-Sent Events

---

## Task 1: DynamoDB Table Schema and Configuration

**Files:**

- Modify: `portal/src/lib/config.ts:50-60`
- Create: `portal/infra/dynamodb-takehome.tf`

**Step 1: Add take-home table configuration**

In `portal/src/lib/config.ts`, add to the database section:

```typescript
database: {
  interviewsTable: getEnvVar('INTERVIEWS_TABLE') || `${projectPrefix}-${environment}-interviews`,
  operationsTable: getEnvVar('OPERATIONS_TABLE') || `${projectPrefix}-${environment}-operations`,
  takehomeTable: getEnvVar('TAKEHOME_TABLE') || `${projectPrefix}-${environment}-takehome`,
},
```

**Step 2: Create Terraform configuration for DynamoDB table**

Create `portal/infra/dynamodb-takehome.tf`:

```hcl
resource "aws_dynamodb_table" "takehome" {
  name         = "${var.project_prefix}-${var.environment}-takehome"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "passcode"

  attribute {
    name = "passcode"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "${var.project_prefix}-${var.environment}-takehome"
    Environment = var.environment
    Project     = var.project_prefix
  }
}
```

**Step 3: Apply Terraform changes (manual)**

Run: `cd infra && terraform apply`
Expected: New DynamoDB table created

**Step 4: Commit**

```bash
git add portal/src/lib/config.ts portal/infra/dynamodb-takehome.tf
git commit -m "feat: add DynamoDB table for take-home tests"
```

---

## Task 2: Take-Home Manager Core Logic

**Files:**

- Create: `portal/src/lib/takehome.ts`

**Step 1: Write failing test for passcode generation**

Create `portal/src/lib/__tests__/takehome.test.ts`:

```typescript
import { TakehomeManager } from '../takehome'

describe('TakehomeManager', () => {
  describe('generatePasscode', () => {
    it('should generate 8-character alphanumeric passcode', () => {
      const manager = new TakehomeManager()
      const passcode = manager.generatePasscode()

      expect(passcode).toHaveLength(8)
      expect(passcode).toMatch(/^[A-Z0-9]{8}$/)
    })

    it('should generate unique passcodes', () => {
      const manager = new TakehomeManager()
      const passcode1 = manager.generatePasscode()
      const passcode2 = manager.generatePasscode()

      expect(passcode1).not.toBe(passcode2)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- takehome.test.ts`
Expected: FAIL with "Cannot find module '../takehome'"

**Step 3: Implement TakehomeManager with passcode generation**

Create `portal/src/lib/takehome.ts`:

```typescript
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { config } from './config'

export interface TakehomeTest {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: 'active' | 'activated' | 'completed' | 'revoked'
  validUntil: Date
  durationMinutes: number
  createdAt: Date
  activatedAt?: Date
  interviewId?: string
  createdBy?: string
  ttl?: number
}

export class TakehomeManager {
  private dynamoClient: DynamoDBClient
  private tableName: string

  constructor() {
    this.dynamoClient = new DynamoDBClient({
      region: config.aws.region,
      credentials: config.aws.getCredentials(),
    })
    this.tableName = config.database.takehomeTable
  }

  /**
   * Generates a random 8-character alphanumeric passcode (uppercase).
   */
  generatePasscode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed ambiguous: 0,O,1,I
    let passcode = ''
    for (let i = 0; i < 8; i++) {
      passcode += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return passcode
  }

  /**
   * Creates a new take-home test invitation.
   */
  async createTakehome(params: {
    candidateName: string
    challenge: string
    customInstructions: string
    availabilityWindowDays: number
    durationMinutes: number
  }): Promise<TakehomeTest> {
    const passcode = this.generatePasscode()
    const now = new Date()
    const validUntil = new Date(
      now.getTime() + params.availabilityWindowDays * 24 * 60 * 60 * 1000
    )

    // TTL for DynamoDB (30 days after validUntil for history)
    const ttl = Math.floor(
      (validUntil.getTime() + 30 * 24 * 60 * 60 * 1000) / 1000
    )

    const takehome: TakehomeTest = {
      passcode,
      candidateName: params.candidateName,
      challenge: params.challenge,
      customInstructions: params.customInstructions,
      status: 'active',
      validUntil,
      durationMinutes: params.durationMinutes,
      createdAt: now,
      ttl,
    }

    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(takehome, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(passcode)',
      })
    )

    return takehome
  }

  /**
   * Gets a take-home test by passcode.
   */
  async getTakehome(passcode: string): Promise<TakehomeTest | null> {
    const result = await this.dynamoClient.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ passcode }),
      })
    )

    if (!result.Item) {
      return null
    }

    const item = unmarshall(result.Item)
    return {
      ...item,
      createdAt: new Date(item.createdAt),
      validUntil: new Date(item.validUntil),
      activatedAt: item.activatedAt ? new Date(item.activatedAt) : undefined,
    } as TakehomeTest
  }

  /**
   * Gets all active take-home tests.
   */
  async getActiveTakehomes(): Promise<TakehomeTest[]> {
    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': 'active',
        }),
      })
    )

    if (!result.Items) {
      return []
    }

    return result.Items.map(item => {
      const data = unmarshall(item)
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        validUntil: new Date(data.validUntil),
        activatedAt: data.activatedAt ? new Date(data.activatedAt) : undefined,
      } as TakehomeTest
    })
  }

  /**
   * Activates a take-home test (candidate clicked Start).
   */
  async activateTakehome(
    passcode: string,
    interviewId: string
  ): Promise<boolean> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ passcode }),
          UpdateExpression:
            'SET #status = :activated, activatedAt = :now, interviewId = :interviewId',
          ConditionExpression: '#status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':active': 'active',
            ':activated': 'activated',
            ':now': new Date().toISOString(),
            ':interviewId': interviewId,
          }),
        })
      )
      return true
    } catch (error) {
      console.error('Failed to activate take-home:', error)
      return false
    }
  }

  /**
   * Revokes a take-home test.
   */
  async revokeTakehome(passcode: string): Promise<boolean> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ passcode }),
          UpdateExpression: 'SET #status = :revoked',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':revoked': 'revoked',
          }),
        })
      )
      return true
    } catch (error) {
      console.error('Failed to revoke take-home:', error)
      return false
    }
  }

  /**
   * Marks a take-home test as completed.
   */
  async completeTakehome(passcode: string): Promise<boolean> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ passcode }),
          UpdateExpression: 'SET #status = :completed',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':completed': 'completed',
          }),
        })
      )
      return true
    } catch (error) {
      console.error('Failed to complete take-home:', error)
      return false
    }
  }
}

export const takehomeManager = new TakehomeManager()
```

**Step 4: Run test to verify it passes**

Run: `npm test -- takehome.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add portal/src/lib/takehome.ts portal/src/lib/__tests__/takehome.test.ts
git commit -m "feat: add TakehomeManager with passcode generation and CRUD operations"
```

---

## Task 3: Create Take-Home API Endpoint

**Files:**

- Create: `portal/src/app/api/takehome/route.ts`

**Step 1: Write failing test for create endpoint**

Create `portal/src/app/api/takehome/__tests__/route.test.ts`:

```typescript
import { POST } from '../route'
import { NextRequest } from 'next/server'

describe('POST /api/takehome', () => {
  it('should create take-home test and return passcode', async () => {
    const request = new NextRequest('http://localhost:3000/api/takehome', {
      method: 'POST',
      body: JSON.stringify({
        candidateName: 'John Doe',
        challenge: 'python',
        customInstructions: 'Complete the algorithm challenge',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.passcode).toHaveLength(8)
    expect(data.url).toContain('/take-home/')
  })

  it('should require candidateName', async () => {
    const request = new NextRequest('http://localhost:3000/api/takehome', {
      method: 'POST',
      body: JSON.stringify({
        challenge: 'python',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- api/takehome`
Expected: FAIL with "Cannot find module '../route'"

**Step 3: Implement create endpoint**

Create `portal/src/app/api/takehome/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'
import { config } from '@/lib/config'

/**
 * Creates a new take-home test invitation.
 *
 * @param request - NextRequest with take-home test parameters
 * @returns JSON response with passcode and URL
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      candidateName,
      challenge,
      customInstructions,
      availabilityWindowDays = 7,
      durationMinutes = 240,
    } = body

    // Validation
    if (!candidateName || !challenge) {
      return NextResponse.json(
        {
          success: false,
          error: 'Candidate name and challenge are required',
        },
        { status: 400 }
      )
    }

    // Create take-home test
    const takehome = await takehomeManager.createTakehome({
      candidateName,
      challenge,
      customInstructions: customInstructions || '',
      availabilityWindowDays,
      durationMinutes,
    })

    // Generate URL
    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'
    const url = `${baseUrl}/take-home/${takehome.passcode}`

    return NextResponse.json({
      success: true,
      passcode: takehome.passcode,
      url,
      validUntil: takehome.validUntil.toISOString(),
    })
  } catch (error) {
    console.error('Error creating take-home test:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create take-home test',
      },
      { status: 500 }
    )
  }
}

/**
 * Lists all active take-home tests.
 *
 * @returns JSON response with active take-home tests
 */
export async function GET() {
  try {
    const takehomes = await takehomeManager.getActiveTakehomes()

    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'

    const takehomesWithUrls = takehomes.map(t => ({
      passcode: t.passcode,
      candidateName: t.candidateName,
      challenge: t.challenge,
      customInstructions: t.customInstructions,
      status: t.status,
      validUntil: t.validUntil.toISOString(),
      createdAt: t.createdAt.toISOString(),
      activatedAt: t.activatedAt?.toISOString(),
      durationMinutes: t.durationMinutes,
      url: `${baseUrl}/take-home/${t.passcode}`,
      interviewId: t.interviewId,
    }))

    return NextResponse.json({ takehomes: takehomesWithUrls })
  } catch (error) {
    console.error('Error listing take-home tests:', error)
    return NextResponse.json(
      {
        error: 'Failed to list take-home tests',
      },
      { status: 500 }
    )
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- api/takehome`
Expected: PASS

**Step 5: Commit**

```bash
git add portal/src/app/api/takehome/
git commit -m "feat: add API endpoints for take-home test creation and listing"
```

---

## Task 4: Revoke and Activate Endpoints

**Files:**

- Create: `portal/src/app/api/takehome/[passcode]/revoke/route.ts`
- Create: `portal/src/app/api/takehome/[passcode]/activate/route.ts`

**Step 1: Implement revoke endpoint**

Create `portal/src/app/api/takehome/[passcode]/revoke/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * Revokes a take-home test and destroys running interview if activated.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response indicating success/failure
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    // Get take-home test
    const takehome = await takehomeManager.getTakehome(passcode)
    if (!takehome) {
      return NextResponse.json(
        { success: false, error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    // If activated, destroy the interview
    if (takehome.status === 'activated' && takehome.interviewId) {
      const operationId = operationManager.createOperation(
        'destroy',
        takehome.interviewId
      )

      // Start background destruction
      setImmediate(async () => {
        try {
          const interview = await interviewManager.getInterview(
            takehome.interviewId!
          )
          if (interview) {
            await operationManager.executeDestroy(
              operationId,
              takehome.interviewId!,
              true // Always save files for take-home tests
            )
          }
        } catch (error) {
          console.error('Error destroying take-home interview:', error)
        }
      })
    }

    // Revoke the take-home test
    const revoked = await takehomeManager.revokeTakehome(passcode)

    if (revoked) {
      return NextResponse.json({
        success: true,
        message: 'Take-home test revoked successfully',
      })
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to revoke take-home test' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error revoking take-home test:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 2: Implement activate endpoint with rate limiting**

Create `portal/src/app/api/takehome/[passcode]/activate/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'
import { operationManager } from '@/lib/operations'

// Rate limiting: Track activation attempts per IP
const activationAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 3
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

/**
 * Activates a take-home test and starts interview provisioning.
 *
 * Includes rate limiting: 3 attempts per IP per hour.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response with operation ID or error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    // Get client IP for rate limiting
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // Check rate limit
    const now = Date.now()
    const attempts = activationAttempts.get(ip)

    if (attempts) {
      if (now < attempts.resetAt) {
        if (attempts.count >= MAX_ATTEMPTS) {
          return NextResponse.json(
            {
              success: false,
              error:
                'Too many activation attempts. Please try again in 1 hour.',
            },
            { status: 429 }
          )
        }
        attempts.count++
      } else {
        // Reset window
        activationAttempts.set(ip, {
          count: 1,
          resetAt: now + RATE_LIMIT_WINDOW_MS,
        })
      }
    } else {
      activationAttempts.set(ip, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      })
    }

    // Get take-home test
    const takehome = await takehomeManager.getTakehome(passcode)
    if (!takehome) {
      return NextResponse.json(
        { success: false, error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    // Validate status
    if (takehome.status !== 'active') {
      return NextResponse.json(
        {
          success: false,
          error:
            takehome.status === 'activated'
              ? 'This take-home test has already been started'
              : takehome.status === 'completed'
                ? 'This take-home test has been completed'
                : 'This take-home test is no longer available',
        },
        { status: 400 }
      )
    }

    // Validate expiry
    if (new Date() > takehome.validUntil) {
      return NextResponse.json(
        {
          success: false,
          error: 'This take-home test invitation has expired',
        },
        { status: 400 }
      )
    }

    // Generate interview ID
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 7)
    const interviewId = `takehome-${timestamp}-${random}`

    // Create operation for interview creation
    const operationId = operationManager.createOperation('create', interviewId)

    // Mark as activated
    await takehomeManager.activateTakehome(passcode, interviewId)

    // Start background provisioning with auto-destroy
    setImmediate(async () => {
      try {
        await operationManager.executeCreate(
          operationId,
          interviewId,
          takehome.candidateName,
          takehome.challenge,
          undefined, // No scheduled time
          takehome.durationMinutes // Auto-destroy after duration
        )
      } catch (error) {
        console.error('Error creating take-home interview:', error)
      }
    })

    return NextResponse.json({
      success: true,
      operationId,
      interviewId,
    })
  } catch (error) {
    console.error('Error activating take-home test:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 3: Commit**

```bash
git add portal/src/app/api/takehome/[passcode]/
git commit -m "feat: add revoke and activate endpoints with rate limiting"
```

---

## Task 5: Candidate View Page

**Files:**

- Create: `portal/src/app/take-home/[passcode]/page.tsx`

**Step 1: Create candidate view page**

Create `portal/src/app/take-home/[passcode]/page.tsx`:

```typescript
'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface TakehomeData {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: string
  validUntil: string
  durationMinutes: number
}

export default function TakeHomePage({
  params,
}: {
  params: Promise<{ passcode: string }>
}) {
  const { passcode } = use(params)
  const router = useRouter()
  const [takehome, setTakehome] = useState<TakehomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const [operationId, setOperationId] = useState<string | null>(null)

  useEffect(() => {
    const fetchTakehome = async () => {
      try {
        const response = await fetch(`/api/takehome/${passcode}`)
        if (response.ok) {
          const data = await response.json()
          setTakehome(data)
        } else {
          const data = await response.json()
          setError(data.error || 'Take-home test not found')
        }
      } catch (err) {
        setError('Failed to load take-home test')
      } finally {
        setLoading(false)
      }
    }

    fetchTakehome()
  }, [passcode])

  const handleStart = async () => {
    if (!takehome) return

    setActivating(true)
    setError(null)

    try {
      const response = await fetch(`/api/takehome/${passcode}/activate`, {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        setOperationId(data.operationId)
        // Redirect to main portal to see progress
        router.push('/')
      } else {
        setError(data.error || 'Failed to start interview')
        setActivating(false)
      }
    } catch (err) {
      setError('Failed to start interview. Please try again.')
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

  if (error || !takehome) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <div className="text-red-600 text-xl font-semibold mb-4">
            ❌ Error
          </div>
          <div className="text-slate-700">{error || 'Invalid invitation'}</div>
        </div>
      </div>
    )
  }

  const validUntil = new Date(takehome.validUntil)
  const isExpired = new Date() > validUntil
  const isAlreadyActivated = takehome.status !== 'active'

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">
              Coding Interview - {takehome.candidateName}
            </h1>
            <div className="text-slate-600">
              Challenge: <span className="font-semibold">{takehome.challenge}</span>
            </div>
            <div className="text-sm text-slate-500 mt-2">
              Valid until: {validUntil.toLocaleString()}
            </div>
          </div>

          {/* Platform Instructions */}
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-3">
              📋 Platform Instructions
            </h2>
            <ul className="space-y-2 text-blue-800 text-sm">
              <li>• Click "Start Interview" to begin provisioning your workspace</li>
              <li>• Your workspace will be ready in approximately 2-3 minutes</li>
              <li>• You will have {takehome.durationMinutes} minutes to complete the challenge</li>
              <li>• Your workspace will automatically shut down after {takehome.durationMinutes} minutes</li>
              <li>• All your work will be automatically saved</li>
              <li>• You can only start this interview once</li>
            </ul>
          </div>

          {/* Custom Instructions */}
          {takehome.customInstructions && (
            <div className="mb-6 bg-slate-50 border border-slate-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">
                📝 Challenge Instructions
              </h2>
              <div className="text-slate-700 whitespace-pre-wrap text-sm">
                {takehome.customInstructions}
              </div>
            </div>
          )}

          {/* Start Button */}
          <div className="mt-8">
            {isExpired ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                ⚠️ This invitation has expired
              </div>
            ) : isAlreadyActivated ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-700">
                ⚠️ This interview has already been started
              </div>
            ) : (
              <button
                onClick={handleStart}
                disabled={activating}
                className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-colors ${
                  activating
                    ? 'bg-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {activating ? 'Starting...' : '🚀 Start Interview'}
              </button>
            )}

            {activating && (
              <div className="mt-4 text-center text-sm text-slate-600">
                Provisioning your workspace... This will take 2-3 minutes.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Create API endpoint to get single take-home**

Create `portal/src/app/api/takehome/[passcode]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'

/**
 * Gets a take-home test by passcode.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response with take-home test data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    const takehome = await takehomeManager.getTakehome(passcode)

    if (!takehome) {
      return NextResponse.json(
        { error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      passcode: takehome.passcode,
      candidateName: takehome.candidateName,
      challenge: takehome.challenge,
      customInstructions: takehome.customInstructions,
      status: takehome.status,
      validUntil: takehome.validUntil.toISOString(),
      durationMinutes: takehome.durationMinutes,
    })
  } catch (error) {
    console.error('Error getting take-home test:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**Step 3: Commit**

```bash
git add portal/src/app/take-home/ portal/src/app/api/takehome/[passcode]/route.ts
git commit -m "feat: add candidate view page for take-home tests"
```

---

## Task 6: Enhanced Create Modal with Take-Home Option

**Files:**

- Modify: `portal/src/app/page.tsx:150-350` (approximate location of create modal)

**Step 1: Read existing create modal code**

Run: Read the file to find the create modal implementation
Expected: Locate the modal form and understand current structure

**Step 2: Add take-home form state**

In `portal/src/app/page.tsx`, add state variables near the top of the component (around line 50):

```typescript
// Existing state...
const [showCreateModal, setShowCreateModal] = useState(false)
const [formData, setFormData] = useState({
  candidateName: '',
  challenge: '',
  enableScheduling: false,
  scheduledAt: '',
  autoDestroyMinutes: 240,
})

// Add new state for take-home mode
const [interviewType, setInterviewType] = useState<
  'instant' | 'scheduled' | 'takehome'
>('instant')
const [takehomeFormData, setTakehomeFormData] = useState({
  candidateName: '',
  challenge: '',
  customInstructions: '',
  availabilityWindowDays: 7,
  durationMinutes: 240,
})
```

**Step 3: Add take-home creation handler**

Add handler function (around line 200):

```typescript
const createTakehome = async () => {
  setNotification(null)
  setCreatingInterview(true)

  try {
    const response = await fetch('/api/takehome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(takehomeFormData),
    })

    const data = await response.json()

    if (response.ok) {
      setNotification(
        `✅ Take-home test created! Passcode: ${data.passcode}\nURL: ${data.url}`
      )
      setShowCreateModal(false)
      // Reset form
      setTakehomeFormData({
        candidateName: '',
        challenge: '',
        customInstructions: '',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      })
      setInterviewType('instant')
    } else {
      setNotification(`❌ Failed to create take-home test: ${data.error}`)
    }
  } catch (error) {
    setNotification('❌ Error creating take-home test')
  } finally {
    setCreatingInterview(false)
  }
}
```

**Step 4: Update create modal UI**

Modify the create modal JSX (around line 300):

```typescript
{showCreateModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
      <h2 className="text-2xl font-bold text-slate-800 mb-4">
        Create New Interview
      </h2>

      {/* Interview Type Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Interview Type
        </label>
        <div className="flex gap-3">
          <button
            onClick={() => setInterviewType('instant')}
            className={`flex-1 py-2 px-4 rounded-lg border-2 transition-colors ${
              interviewType === 'instant'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            ⚡ Instant
          </button>
          <button
            onClick={() => setInterviewType('scheduled')}
            className={`flex-1 py-2 px-4 rounded-lg border-2 transition-colors ${
              interviewType === 'scheduled'
                ? 'border-purple-600 bg-purple-50 text-purple-700'
                : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            ⏰ Scheduled
          </button>
          <button
            onClick={() => setInterviewType('takehome')}
            className={`flex-1 py-2 px-4 rounded-lg border-2 transition-colors ${
              interviewType === 'takehome'
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            📦 Take-Home
          </button>
        </div>
      </div>

      {/* Conditional Forms */}
      {interviewType === 'takehome' ? (
        <TakehomeForm
          formData={takehomeFormData}
          setFormData={setTakehomeFormData}
          challenges={challenges}
          onSubmit={createTakehome}
          onCancel={() => {
            setShowCreateModal(false)
            setInterviewType('instant')
          }}
          creating={creatingInterview}
        />
      ) : (
        // Existing instant/scheduled form...
      )}
    </div>
  </div>
)}
```

**Step 5: Create TakehomeForm component**

Add component near the top of the file (after imports):

```typescript
function TakehomeForm({
  formData,
  setFormData,
  challenges,
  onSubmit,
  onCancel,
  creating,
}: {
  formData: {
    candidateName: string
    challenge: string
    customInstructions: string
    availabilityWindowDays: number
    durationMinutes: number
  }
  setFormData: (data: any) => void
  challenges: Array<{ name: string }>
  onSubmit: () => void
  onCancel: () => void
  creating: boolean
}) {
  return (
    <>
      {/* Candidate Name */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Candidate Name
        </label>
        <input
          type="text"
          value={formData.candidateName}
          onChange={e =>
            setFormData({ ...formData, candidateName: e.target.value })
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
          placeholder="John Doe"
          required
        />
      </div>

      {/* Challenge Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Challenge
        </label>
        <select
          value={formData.challenge}
          onChange={e => setFormData({ ...formData, challenge: e.target.value })}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
          required
        >
          <option value="">Select a challenge</option>
          {challenges.map(c => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Custom Instructions */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Custom Instructions
        </label>
        <textarea
          value={formData.customInstructions}
          onChange={e =>
            setFormData({ ...formData, customInstructions: e.target.value })
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
          rows={4}
          placeholder="Specific instructions for the candidate..."
        />
      </div>

      {/* Availability Window */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Availability Window (days)
        </label>
        <input
          type="number"
          value={formData.availabilityWindowDays}
          onChange={e =>
            setFormData({
              ...formData,
              availabilityWindowDays: parseInt(e.target.value) || 7,
            })
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
          min={1}
          max={30}
        />
        <div className="text-xs text-slate-500 mt-1">
          How many days the candidate has to start the interview
        </div>
      </div>

      {/* Duration */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Interview Duration
        </label>
        <select
          value={formData.durationMinutes}
          onChange={e =>
            setFormData({
              ...formData,
              durationMinutes: parseInt(e.target.value),
            })
          }
          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
        >
          <option value={30}>30 minutes</option>
          <option value={45}>45 minutes</option>
          <option value={60}>1 hour</option>
          <option value={90}>1.5 hours</option>
          <option value={120}>2 hours</option>
          <option value={180}>3 hours</option>
          <option value={240}>4 hours</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={creating || !formData.candidateName || !formData.challenge}
          className="flex-1 btn-primary"
        >
          {creating ? 'Creating...' : '📦 Create Take-Home'}
        </button>
      </div>
    </>
  )
}
```

**Step 6: Commit**

```bash
git add portal/src/app/page.tsx
git commit -m "feat: add take-home option to create interview modal"
```

---

## Task 7: Take-Home Tests Table Component

**Files:**

- Create: `portal/src/components/TakehomeTable.tsx`
- Modify: `portal/src/app/page.tsx` (add new tab)

**Step 1: Create TakehomeTable component**

Create `portal/src/components/TakehomeTable.tsx`:

```typescript
'use client'

import { useState } from 'react'

interface Takehome {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: string
  validUntil: string
  createdAt: string
  activatedAt?: string
  durationMinutes: number
  url: string
  interviewId?: string
}

interface TakehomeTableProps {
  takehomes: Takehome[]
  onRevoke: (passcode: string) => void
}

export function TakehomeTable({ takehomes, onRevoke }: TakehomeTableProps) {
  const [copiedPasscode, setCopiedPasscode] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const copyToClipboard = (text: string, passcode: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPasscode(passcode)
    setTimeout(() => setCopiedPasscode(null), 2000)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
            Active
          </span>
        )
      case 'activated':
        return (
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
            In Progress
          </span>
        )
      case 'completed':
        return (
          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">
            Completed
          </span>
        )
      case 'revoked':
        return (
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">
            Revoked
          </span>
        )
      default:
        return (
          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">
            {status}
          </span>
        )
    }
  }

  if (takehomes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        No take-home tests created yet
      </div>
    )
  }

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
              Passcode
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
            const validUntil = new Date(takehome.validUntil)
            const isExpired = new Date() > validUntil
            const isExpanded = expandedRow === takehome.passcode

            return (
              <>
                <tr
                  key={takehome.passcode}
                  className="border-b border-slate-200 hover:bg-slate-50"
                >
                  <td className="py-3 px-4 font-medium text-slate-800">
                    {takehome.candidateName}
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {takehome.challenge}
                  </td>
                  <td className="py-3 px-4">
                    <code className="bg-slate-100 px-2 py-1 rounded text-sm font-mono">
                      {takehome.passcode}
                    </code>
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(takehome.status)}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {isExpired ? (
                      <span className="text-red-600">Expired</span>
                    ) : (
                      validUntil.toLocaleString()
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          copyToClipboard(takehome.url, takehome.passcode)
                        }
                        className="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded"
                      >
                        {copiedPasscode === takehome.passcode
                          ? '✓ Copied'
                          : '📋 Copy URL'}
                      </button>
                      {takehome.status === 'active' && (
                        <button
                          onClick={() => onRevoke(takehome.passcode)}
                          className="text-sm px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                        >
                          Revoke
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setExpandedRow(isExpanded ? null : takehome.passcode)
                        }
                        className="text-sm px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                      >
                        {isExpanded ? '▲ Hide' : '▼ Details'}
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
                            URL:
                          </div>
                          <div className="text-sm text-blue-600 font-mono break-all">
                            {takehome.url}
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
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

**Step 2: Add take-home tab to main page**

In `portal/src/app/page.tsx`, add new tab state and fetch logic (around line 50):

```typescript
const [activeTab, setActiveTab] = useState<'current' | 'history' | 'takehome'>(
  'current'
)
const [takehomes, setTakehomes] = useState<Takehome[]>([])

const fetchTakehomes = async () => {
  try {
    const response = await fetch('/api/takehome')
    if (response.ok) {
      const data = await response.json()
      setTakehomes(data.takehomes)
    }
  } catch (error) {
    console.error('Failed to fetch take-home tests:', error)
  }
}

useEffect(() => {
  if (activeTab === 'takehome') {
    fetchTakehomes()
  }
}, [activeTab])

// Add revoke handler
const revokeTakehome = async (passcode: string) => {
  try {
    const response = await fetch(`/api/takehome/${passcode}/revoke`, {
      method: 'POST',
    })
    if (response.ok) {
      setNotification('✅ Take-home test revoked')
      fetchTakehomes()
    } else {
      const data = await response.json()
      setNotification(`❌ Failed to revoke: ${data.error}`)
    }
  } catch (error) {
    setNotification('❌ Error revoking take-home test')
  }
}
```

Add tab button (around line 400):

```typescript
<div className="flex gap-2 mb-6">
  <button
    onClick={() => setActiveTab('current')}
    className={`px-4 py-2 rounded-lg ${
      activeTab === 'current'
        ? 'bg-blue-600 text-white'
        : 'bg-slate-200 text-slate-700'
    }`}
  >
    Current Interviews
  </button>
  <button
    onClick={() => setActiveTab('takehome')}
    className={`px-4 py-2 rounded-lg ${
      activeTab === 'takehome'
        ? 'bg-blue-600 text-white'
        : 'bg-slate-200 text-slate-700'
    }`}
  >
    Take-Home Tests
  </button>
  <button
    onClick={() => setActiveTab('history')}
    className={`px-4 py-2 rounded-lg ${
      activeTab === 'history'
        ? 'bg-blue-600 text-white'
        : 'bg-slate-200 text-slate-700'
    }`}
  >
    History
  </button>
</div>

{activeTab === 'takehome' && (
  <TakehomeTable takehomes={takehomes} onRevoke={revokeTakehome} />
)}
```

**Step 3: Commit**

```bash
git add portal/src/components/TakehomeTable.tsx portal/src/app/page.tsx
git commit -m "feat: add take-home tests table and tab in main UI"
```

---

## Task 8: Integration with Operations System

**Files:**

- Modify: `portal/src/lib/operations.ts:400-450`

**Step 1: Update operation completion to mark take-home complete**

In `portal/src/lib/operations.ts`, find the `executeDestroy` method and add take-home completion logic:

```typescript
async executeDestroy(
  operationId: string,
  interviewId: string,
  saveFiles: boolean
): Promise<void> {
  this.updateOperationStatus(operationId, 'running')

  try {
    // Existing destroy logic...

    // Check if this is a take-home interview and mark complete
    if (interviewId.startsWith('takehome-')) {
      const takehomes = await takehomeManager.getActiveTakehomes()
      const takehome = takehomes.find(t => t.interviewId === interviewId)
      if (takehome) {
        await takehomeManager.completeTakehome(takehome.passcode)
      }
    }

    this.setOperationResult(operationId, { success: true })
  } catch (error) {
    this.setOperationResult(operationId, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
```

**Step 2: Import takehomeManager**

At the top of `portal/src/lib/operations.ts`:

```typescript
import { takehomeManager } from './takehome'
```

**Step 3: Commit**

```bash
git add portal/src/lib/operations.ts
git commit -m "feat: integrate take-home completion with operations system"
```

---

## Task 9: Testing and Documentation

**Files:**

- Create: `portal/src/lib/__tests__/takehome.integration.test.ts`
- Update: `CLAUDE.md`

**Step 1: Create integration tests**

Create `portal/src/lib/__tests__/takehome.integration.test.ts`:

```typescript
import { TakehomeManager } from '../takehome'

describe('TakehomeManager Integration', () => {
  let manager: TakehomeManager

  beforeEach(() => {
    manager = new TakehomeManager()
  })

  describe('full lifecycle', () => {
    it('should create, activate, and complete take-home test', async () => {
      // Create
      const takehome = await manager.createTakehome({
        candidateName: 'Test Candidate',
        challenge: 'python',
        customInstructions: 'Complete the challenge',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      })

      expect(takehome.status).toBe('active')
      expect(takehome.passcode).toHaveLength(8)

      // Get
      const retrieved = await manager.getTakehome(takehome.passcode)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.candidateName).toBe('Test Candidate')

      // Activate
      const activated = await manager.activateTakehome(
        takehome.passcode,
        'test-interview-123'
      )
      expect(activated).toBe(true)

      const afterActivation = await manager.getTakehome(takehome.passcode)
      expect(afterActivation?.status).toBe('activated')
      expect(afterActivation?.interviewId).toBe('test-interview-123')

      // Complete
      const completed = await manager.completeTakehome(takehome.passcode)
      expect(completed).toBe(true)

      const afterCompletion = await manager.getTakehome(takehome.passcode)
      expect(afterCompletion?.status).toBe('completed')
    })

    it('should handle revocation', async () => {
      const takehome = await manager.createTakehome({
        candidateName: 'Test Candidate',
        challenge: 'python',
        customInstructions: 'Test',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      })

      const revoked = await manager.revokeTakehome(takehome.passcode)
      expect(revoked).toBe(true)

      const afterRevoke = await manager.getTakehome(takehome.passcode)
      expect(afterRevoke?.status).toBe('revoked')
    })
  })
})
```

**Step 2: Update CLAUDE.md documentation**

Add to `CLAUDE.md` under "User Flow" section:

```markdown
8. [x] **Take-Home Test Management**
   1. [x] Create take-home test with configurable availability window (default 7 days)
   2. [x] Generate unique 8-character passcode and shareable URL
   3. [x] Add custom instructions for candidates
   4. [x] Candidate accesses via `/take-home/{passcode}` route
   5. [x] Candidate sees platform + custom instructions before starting
   6. [x] One-click activation with rate limiting (3 attempts per IP per hour)
   7. [x] Automatic instance provisioning with configurable duration (default 4 hours)
   8. [x] Auto-destroy after duration with file saving
   9. [x] Manager can revoke take-home (destroys running instance if activated)
   10. [x] Take-home tests table showing status, passcode, URL, and actions
   11. [x] Completed take-homes moved to history automatically
```

**Step 3: Run all tests**

Run: `npm run test:all`
Expected: All tests pass

**Step 4: Commit**

```bash
git add portal/src/lib/__tests__/takehome.integration.test.ts CLAUDE.md
git commit -m "test: add integration tests and update documentation for take-home feature"
```

---

## Task 10: Final Verification and Cleanup

**Files:**

- Run linter and formatter
- Verify build

**Step 1: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 2: Run formatter**

Run: `npm run format`
Expected: Code formatted

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: lint and format take-home feature code"
```

**Step 5: Create feature branch and PR** (manual)

Run: `git checkout -b feature/take-home-tests`
Run: `git push -u origin feature/take-home-tests`
Run: `gh pr create --title "feat: add take-home test functionality" --body "..."`

---

## Implementation Complete

**Total Tasks:** 10
**Estimated Time:** 2-3 hours for experienced developer with codebase familiarity

**Key Features Implemented:**

- DynamoDB table with TTL and GSI for take-home tests
- Complete CRUD operations via TakehomeManager
- API endpoints: create, list, get, activate, revoke
- Candidate view page with rate limiting
- Enhanced create modal with take-home option
- Take-home tests table with status tracking
- Integration with existing operations system
- Comprehensive tests and documentation

**Next Steps:**

- Deploy infrastructure changes (Terraform)
- Test end-to-end flow manually
- Monitor for edge cases and performance issues
