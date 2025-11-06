import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

/**
 * Cancels a running or pending operation.
 *
 * Only operations with status 'pending' or 'running' can be cancelled.
 * Once cancelled, the operation status changes to 'cancelled' and it
 * will not execute. This triggers SSE events to notify connected clients.
 *
 * Note: This cancels the operation tracking but may not stop already
 * running infrastructure operations (like Terraform commands).
 *
 * @param request - NextRequest object (unused)
 * @param params - Route parameters containing the operation ID
 * @returns JSON response indicating success/failure of cancellation
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/operations/op-123/cancel', {
 *   method: 'POST'
 * })
 * const result = await response.json()
 * if (result.success) {
 *   console.log('Operation cancelled')
 * }
 * ```
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const operationId = id

    if (!operationId) {
      return NextResponse.json(
        { success: false, error: 'Operation ID is required' },
        { status: 400 }
      )
    }

    const operation = await operationManager.getOperation(operationId)
    if (!operation) {
      return NextResponse.json(
        { success: false, error: 'Operation not found' },
        { status: 404 }
      )
    }

    // Check if operation can be cancelled
    if (
      operation.status !== 'pending' &&
      operation.status !== 'running' &&
      operation.status !== 'scheduled'
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot cancel operation with status: ${operation.status}`,
        },
        { status: 400 }
      )
    }

    const cancelled = await operationManager.cancelOperation(operationId)

    if (cancelled) {
      return NextResponse.json({
        success: true,
        message: 'Operation cancelled successfully',
        operation: await operationManager.getOperation(operationId),
      })
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to cancel operation' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error cancelling operation:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
