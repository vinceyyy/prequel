import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

/**
 * Retrieves execution logs for a specific operation.
 *
 * Supports incremental log fetching using the `from` query parameter.
 * This allows the UI to fetch only new logs since the last request,
 * enabling efficient real-time log streaming and reducing bandwidth.
 *
 * @param request - NextRequest with optional `from` query parameter (log index)
 * @param params - Route parameters containing the operation ID
 * @returns JSON response with logs array and operation metadata
 *
 * @example
 * ```typescript
 * // Get all logs
 * const response = await fetch('/api/operations/op-123/logs')
 * const { logs, totalLogs } = await response.json()
 *
 * // Get logs from index 50 onwards (incremental)
 * const response = await fetch('/api/operations/op-123/logs?from=50')
 * const { logs } = await response.json()
 * ```
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const operationId = id
    const operation = await operationManager.getOperation(operationId)

    if (!operation) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      )
    }

    const url = new URL(request.url)
    const fromIndex = parseInt(url.searchParams.get('from') || '0')

    // Return logs from a specific index (for incremental fetching)
    const logs = operation.logs.slice(fromIndex)

    return NextResponse.json({
      logs,
      totalLogs: operation.logs.length,
      operation: {
        id: operation.id,
        status: operation.status,
        type: operation.type,
        interviewId: operation.interviewId,
        createdAt: operation.createdAt,
        executionStartedAt: operation.executionStartedAt,
        completedAt: operation.completedAt,
        result: operation.result,
      },
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to get operation logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
