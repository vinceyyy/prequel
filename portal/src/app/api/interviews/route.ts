import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'
import { v4 as uuidv4 } from 'uuid'

// Shared execution to prevent multiple simultaneous S3 queries (NO caching)
interface SharedResult {
  workspaceInterviews: string[]
  completedInterviews: Array<{
    id: string
    candidateName: string
    scenario: string
    status: string
    accessUrl?: string
    password?: string
    createdAt: string
  }>
}

let activeQuery: Promise<SharedResult> | null = null // Shared promise for concurrent requests

async function performExpensiveQuery(): Promise<SharedResult> {
  // Use S3 workspaces as source of truth for what interviews exist (EXPENSIVE)
  const workspaceInterviews = await terraformManager.listActiveInterviews()

  const completedInterviewsPromises = workspaceInterviews.map(async id => {
    // Try to get Terraform status first (EXPENSIVE)
    const status = await terraformManager.getInterviewStatus(id)

    if (status.success && status.outputs) {
      const outputs = status.outputs as Record<string, { value: string }>

      // Only return interview if it has valid candidate name and scenario
      // This prevents malformed data during creation process
      if (outputs.candidate_name?.value && outputs.scenario?.value) {
        return {
          id,
          candidateName: outputs.candidate_name.value,
          scenario: outputs.scenario.value,
          status: 'active',
          accessUrl: outputs.access_url?.value,
          password: outputs.password?.value,
          createdAt: outputs.created_at?.value || new Date().toISOString(),
        }
      } else {
        console.log(
          `[DEBUG] Skipping interview ${id} - incomplete terraform outputs during creation`
        )
        return null
      }
    }

    // If Terraform status fails, this might be a failed destroy attempt
    // Check if there's a recent destroy operation for this interview
    const operations = operationManager.getAllOperations()
    const destroyOperation = operations
      .filter(op => op.type === 'destroy' && op.interviewId === id)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]

    if (destroyOperation) {
      return {
        id,
        candidateName: destroyOperation.candidateName || 'Unknown',
        scenario: destroyOperation.scenario || 'unknown',
        status:
          destroyOperation.status === 'running'
            ? 'destroying'
            : destroyOperation.status === 'failed'
              ? 'error'
              : 'error',
        createdAt: destroyOperation.startedAt.toISOString(),
      }
    }

    // Fallback for interviews with workspace but no valid state or operations
    return {
      id,
      candidateName: 'Unknown',
      scenario: 'unknown',
      status: 'error',
      createdAt: new Date().toISOString(),
    }
  })

  const completedInterviewsResults = await Promise.all(
    completedInterviewsPromises
  )
  const completedInterviews = completedInterviewsResults.filter(
    interview => interview !== null
  )

  return { workspaceInterviews, completedInterviews }
}

function getOperationInterviews(
  operations: Array<{
    type: string
    interviewId: string
    candidateName?: string
    scenario?: string
    status: string
    result?: {
      success: boolean
      accessUrl?: string
      password?: string
    }
    startedAt: Date
  }>
) {
  return operations
    .filter(op => op.type === 'create')
    .map(op => ({
      id: op.interviewId,
      candidateName: op.candidateName || 'Unknown',
      scenario: op.scenario || 'unknown',
      status:
        op.status === 'pending'
          ? 'creating'
          : op.status === 'running'
            ? 'creating'
            : op.status === 'completed'
              ? op.result?.success
                ? 'active'
                : 'error'
              : 'error',
      accessUrl: op.result?.accessUrl,
      password: op.result?.password || '',
      createdAt: op.startedAt.toISOString(),
    }))
}

function mergeAndDeduplicateInterviews(
  allInterviews: Array<{
    id: string
    candidateName: string
    scenario: string
    status: string
    accessUrl?: string
    password?: string
    createdAt: string
  }>,
  operations: Array<{
    type: string
    interviewId: string
    status: string
    result?: {
      success: boolean
    }
    startedAt: Date
  }>
) {
  // Apply destroy operation status updates
  const destroyOperationUpdates = new Map()
  operations
    .filter(op => op.type === 'destroy')
    .forEach(op => {
      const existing = destroyOperationUpdates.get(op.interviewId)
      if (!existing || op.startedAt.getTime() > existing.startedAt.getTime()) {
        destroyOperationUpdates.set(op.interviewId, op)
      }
    })

  const interviewMap = new Map()

  // Add all interviews
  allInterviews.forEach(interview => {
    const existing = interviewMap.get(interview.id)
    if (
      existing &&
      existing.status === 'active' &&
      interview.status !== 'active'
    ) {
      return // Keep the active one
    }
    interviewMap.set(interview.id, interview)
  })

  // Apply destroy operation status updates
  destroyOperationUpdates.forEach((destroyOp, interviewId) => {
    const existing = interviewMap.get(interviewId)
    if (existing) {
      const updatedInterview = {
        ...existing,
        status:
          destroyOp.status === 'running'
            ? 'destroying'
            : destroyOp.status === 'failed'
              ? 'error'
              : destroyOp.status === 'completed'
                ? destroyOp.result?.success
                  ? 'destroyed'
                  : 'error'
                : existing.status,
      }
      interviewMap.set(interviewId, updatedInterview)
    }
  })

  return Array.from(interviewMap.values())
    .filter(interview => interview.status !== 'destroyed')
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
}

export async function GET() {
  try {
    // Get ongoing operations (this is fast - just in-memory operations)
    const operations = operationManager.getAllOperations()

    // Check if there's already an active query - if so, share its result
    if (activeQuery) {
      console.log(
        '[DEBUG] Another user is already querying S3, sharing result...'
      )
      const sharedResult = await activeQuery

      // Merge with operations and return
      const operationInterviews = getOperationInterviews(operations)
      const allInterviews = [
        ...sharedResult.completedInterviews,
        ...operationInterviews,
      ]
      const interviews = mergeAndDeduplicateInterviews(
        allInterviews,
        operations
      )

      return NextResponse.json({ interviews })
    }

    // Create new query that other concurrent requests can share
    console.log('[DEBUG] Starting fresh S3 query (no active query)')
    activeQuery = performExpensiveQuery()

    try {
      const result = await activeQuery

      // Add interviews from operations
      const operationInterviews = getOperationInterviews(operations)
      const allInterviews = [
        ...result.completedInterviews,
        ...operationInterviews,
      ]
      const interviews = mergeAndDeduplicateInterviews(
        allInterviews,
        operations
      )

      console.log(
        `[DEBUG] Final interviews at ${new Date().toISOString()}:`,
        interviews.map(i => ({
          id: i.id,
          status: i.status,
          candidateName: i.candidateName,
        }))
      )

      return NextResponse.json({ interviews })
    } finally {
      // Clear the active query so next request will be fresh
      activeQuery = null
    }
  } catch (error: unknown) {
    // Clear the active query on error
    activeQuery = null
    return NextResponse.json(
      {
        error: 'Failed to list interviews',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { candidateName, scenario } = body

    if (!candidateName || !scenario) {
      return NextResponse.json(
        { error: 'candidateName and scenario are required' },
        { status: 400 }
      )
    }

    const interviewId = uuidv4().substring(0, 8)
    const password = Math.random().toString(36).substring(2, 12)

    const instance = {
      id: interviewId,
      candidateName,
      scenario,
      password,
    }

    console.log(instance)

    // Start Terraform provisioning in background
    const result = await terraformManager.createInterview(instance)

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Failed to create interview infrastructure',
          details: result.error,
          terraformOutput: result.output,
          fullOutput: result.fullOutput,
          executionLog: result.executionLog,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      interview: {
        id: interviewId,
        candidateName,
        scenario,
        status: 'active',
        accessUrl: result.accessUrl,
        password,
        createdAt: new Date().toISOString(),
      },
      terraformOutput: result.output,
      fullOutput: result.fullOutput,
      executionLog: result.executionLog,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to create interview',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
