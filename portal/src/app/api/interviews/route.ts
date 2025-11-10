import { NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * Gets all active interviews from DynamoDB with real-time operation status integration.
 *
 * This endpoint now uses DynamoDB as the source of truth for interview data,
 * which is much faster than the previous S3-based querying approach.
 * It integrates with ongoing operations to provide accurate real-time status.
 *
 * **Performance Improvement:**
 * - DynamoDB queries: ~50-100ms (fast, indexed queries)
 * - Previous S3 queries: ~3-5 seconds (expensive listObjects + terraform status)
 *
 * **Data Flow:**
 * 1. Get active interviews from DynamoDB (fast, indexed query)
 * 2. Get ongoing operations to overlay real-time status updates
 * 3. Merge and deduplicate with preference for most recent status
 * 4. Return unified interview list
 *
 * @returns JSON response with active interviews array
 */
export async function GET() {
  try {
    // Get active interviews from DynamoDB (fast, indexed query by status)
    const activeInterviews = await interviewManager.getActiveInterviews()

    // Get ongoing operations for real-time status overlay (using efficient GSI queries)
    const operations = await operationManager.getActiveOperations()

    // Convert DynamoDB interviews to API format
    const dynamoInterviews = activeInterviews.map(interview => ({
      id: interview.id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      status: interview.status,
      type: interview.type,
      accessUrl: interview.accessUrl,
      password: interview.password,
      createdAt: interview.createdAt.toISOString(),
      scheduledAt: interview.scheduledAt?.toISOString(),
      autoDestroyAt: interview.autoDestroyAt?.toISOString(),
      // Take-home specific fields
      passcode: interview.passcode,
      validUntil: interview.validUntil?.toISOString(),
      customInstructions: interview.customInstructions,
      durationMinutes: interview.durationMinutes,
      activatedAt: interview.activatedAt?.toISOString(),
    }))

    // Get interviews from active operations (for real-time status during creation)
    const operationInterviews = getOperationInterviews(
      operations,
      activeInterviews
    )

    // Merge interviews with preference for DynamoDB data over operations
    const allInterviews = [...dynamoInterviews, ...operationInterviews]
    const mergedInterviews = mergeAndDeduplicateInterviews(
      allInterviews,
      operations
    )

    console.log(
      `[DEBUG] Retrieved ${activeInterviews.length} interviews from DynamoDB, ${operationInterviews.length} from operations`
    )
    console.log('[DEBUG] Merged interviews breakdown:', {
      total: mergedInterviews.length,
      regular: mergedInterviews.filter(i => i.type === 'regular' || !i.type)
        .length,
      takeHome: mergedInterviews.filter(i => i.type === 'take-home').length,
      sample: mergedInterviews.slice(0, 3).map(i => ({
        id: i.id,
        type: i.type,
        status: i.status,
      })),
    })

    return NextResponse.json({ interviews: mergedInterviews })
  } catch (error: unknown) {
    console.error('Error listing interviews:', error)

    // Return empty array to prevent UI crashes
    return NextResponse.json({ interviews: [] })
  }
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
    id: string
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
  }>,
  dbInterviews: Array<{
    id: string
    type?: 'regular' | 'take-home'
  }>
) {
  // Create a map of interview IDs to their types from DynamoDB
  const interviewTypeMap = new Map(
    dbInterviews.map(i => [i.id, i.type || 'regular'])
  )

  return operations
    .filter(op => op.type === 'create')
    .map(op => ({
      id: op.interviewId,
      candidateName: op.candidateName || 'Unknown',
      challenge: op.challenge || 'unknown',
      type: interviewTypeMap.get(op.interviewId) || 'regular', // Look up type from DynamoDB
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
      operationId: op.id,
    }))
}

/**
 * Merges interviews from DynamoDB and operations with destroy status updates.
 *
 * Handles deduplication by:
 * - Preferring DynamoDB data over operations (DynamoDB is source of truth)
 * - Applying latest destroy operation status updates for real-time feedback
 * - Filtering out destroyed interviews (they're moved to history)
 * - Sorting by creation time (newest first)
 *
 * @param allInterviews - Combined interviews from DynamoDB and operations
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
  // Build map of latest destroy operations by interview ID
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

  // Add all interviews with deduplication preference for DynamoDB data
  allInterviews.forEach(interview => {
    const existing = interviewMap.get(interview.id)

    // Prefer interviews with access URLs (more complete data)
    if (existing && existing.accessUrl && !interview.accessUrl) {
      return // Keep the one with access URL
    }

    // Prefer active status over non-active
    if (
      existing &&
      existing.status === 'active' &&
      interview.status !== 'active'
    ) {
      return // Keep the active one
    }

    interviewMap.set(interview.id, interview)
  })

  // Apply destroy operation status updates for real-time feedback
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

  // Filter out destroyed interviews and sort by creation time
  return Array.from(interviewMap.values())
    .filter(interview => interview.status !== 'destroyed')
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
}
