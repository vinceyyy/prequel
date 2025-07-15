import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

/**
 * Retrieves a specific operation by its ID.
 *
 * Returns detailed information about a background operation including its status,
 * execution logs, results, and timing information. Used by the UI to show
 * operation details and track specific task progress.
 *
 * @param request - NextRequest object (unused)
 * @param params - Route parameters containing the operation ID
 * @returns JSON response with operation details or 404 if not found
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/operations/op-123')
 * if (response.ok) {
 *   const { operation } = await response.json()
 *   console.log(operation.status, operation.logs)
 * }
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

    return NextResponse.json({ operation })
  } catch (error: unknown) {
    console.error('Error getting operation:', error)

    // Return 404 for any DynamoDB errors
    return NextResponse.json({ error: 'Operation not found' }, { status: 404 })
  }
}
