import { NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'

// Shared execution to prevent multiple simultaneous S3 queries (NO caching)
interface SharedResult {
  workspaceInterviews: string[]
  completedInterviews: Array<{
    id: string
    candidateName: string
    challenge: string
    status: string
    accessUrl?: string
    password?: string
    createdAt: string
    scheduledAt?: string
    autoDestroyAt?: string
  }>
}

let activeQuery: Promise<SharedResult> | null = null // Shared promise for concurrent requests

/**
 * Performs expensive S3 and Terraform queries to get interview status.
 *
 * This function is shared between concurrent requests to avoid duplicate expensive operations.
 * It queries S3 for workspace data and Terraform for interview status, which can take
 * several seconds to complete.
 *
 * @returns Promise resolving to workspace interviews and completed interview data
 */
async function performExpensiveQuery(): Promise<SharedResult> {
  // Use S3 workspaces as source of truth for what interviews exist (EXPENSIVE)
  const workspaceInterviews = await terraformManager.listActiveInterviews()

  const completedInterviewsPromises = workspaceInterviews.map(async id => {
    // Try to get Terraform status first (EXPENSIVE)
    const status = await terraformManager.getInterviewStatus(id)

    if (status.success && status.outputs) {
      const outputs = status.outputs as Record<string, { value: string }>

      // Only return interview if it has valid candidate name and challenge
      // This prevents malformed data during creation process
      if (outputs.candidate_name?.value && outputs.challenge?.value) {
        return {
          id,
          candidateName: outputs.candidate_name.value,
          challenge: outputs.challenge.value,
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
    const operations = await operationManager.getAllOperations()
    const destroyOperation = operations
      .filter(op => op.type === 'destroy' && op.interviewId === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

    if (destroyOperation) {
      return {
        id,
        candidateName: destroyOperation.candidateName || 'Unknown',
        challenge: destroyOperation.challenge || 'unknown',
        status:
          destroyOperation.status === 'running'
            ? 'destroying'
            : destroyOperation.status === 'failed'
              ? 'error'
              : 'error',
        createdAt: destroyOperation.createdAt.toISOString(),
      }
    }

    // Fallback for interviews with workspace but no valid state or operations
    return {
      id,
      candidateName: 'Unknown',
      challenge: 'unknown',
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

/**
 * Converts operation data into interview format with proper status mapping.
 *
 * Maps operation statuses to interview statuses:
 * - scheduled → scheduled (waiting for scheduled time)
 * - pending → initializing (operation not yet started)
 * - running + !infrastructureReady → initializing (Terraform provisioning resources)
 * - running + infrastructureReady → configuring (ECS container booting up)
 * - completed + success + healthCheckPassed → active (fully ready)
 * - completed + success + !healthCheckPassed → configuring (infrastructure ready but service not accessible)
 * - completed + !success → error (creation failed)
 * - failed → error (operation failed)
 *
 * @param operations - Array of operation objects to convert
 * @returns Array of interview objects with mapped statuses
 */
function getOperationInterviews(
  operations: Array<{
    type: string
    interviewId: string
    candidateName?: string
    challenge?: string
    status: string
    scheduledAt?: Date
    autoDestroyAt?: Date
    result?: {
      success: boolean
      accessUrl?: string
      password?: string
      healthCheckPassed?: boolean
      infrastructureReady?: boolean
    }
    createdAt: Date
  }>
) {
  return operations
    .filter(op => op.type === 'create')
    .map(op => ({
      id: op.interviewId,
      candidateName: op.candidateName || 'Unknown',
      challenge: op.challenge || 'unknown',
      status:
        op.status === 'scheduled'
          ? 'scheduled'
          : op.status === 'pending'
            ? 'initializing'
            : op.status === 'running'
              ? op.result?.infrastructureReady
                ? 'configuring' // Infrastructure ready, ECS container booting up
                : 'initializing' // Still running Terraform to provision resources
              : op.status === 'completed'
                ? op.result?.success
                  ? op.result?.healthCheckPassed
                    ? 'active'
                    : 'configuring' // Infrastructure created but health check failed
                  : 'error'
                : 'error',
      accessUrl: op.result?.accessUrl,
      password: op.result?.password || '',
      createdAt: op.createdAt.toISOString(),
      scheduledAt: op.scheduledAt?.toISOString(),
      autoDestroyAt: op.autoDestroyAt?.toISOString(),
    }))
}

/**
 * Merges interviews from multiple sources and applies destroy operation status updates.
 *
 * Handles deduplication by:
 * - Preferring active interviews over non-active ones
 * - Applying latest destroy operation status updates
 * - Filtering out destroyed interviews
 * - Sorting by creation time (newest first)
 *
 * @param allInterviews - Combined interviews from operations and terraform
 * @param operations - All operations for applying destroy status updates
 * @returns Deduplicated and sorted array of interviews
 */
function mergeAndDeduplicateInterviews(
  allInterviews: Array<{
    id: string
    candidateName: string
    challenge: string
    status: string
    accessUrl?: string
    password?: string
    createdAt: string
    scheduledAt?: string
    autoDestroyAt?: string
  }>,
  operations: Array<{
    type: string
    interviewId: string
    status: string
    result?: {
      success: boolean
      healthCheckPassed?: boolean
    }
    createdAt: Date
  }>
) {
  // Apply destroy operation status updates
  const destroyOperationUpdates = new Map()
  operations
    .filter(op => op.type === 'destroy')
    .forEach(op => {
      const existing = destroyOperationUpdates.get(op.interviewId)
      if (!existing || op.createdAt.getTime() > existing.createdAt.getTime()) {
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
    const operations = await operationManager.getAllOperations()

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
    console.error('Error listing interviews:', error)

    // Return empty array to prevent UI crashes
    return NextResponse.json({ interviews: [] })
  }
}
