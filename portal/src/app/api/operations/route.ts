import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

/**
 * Retrieves operations (background tasks) from the operation manager.
 *
 * Supports two modes:
 * 1. Get all operations: `GET /api/operations`
 * 2. Get operations for specific interview: `GET /api/operations?interviewId=abc123`
 *
 * Operations include create/destroy tasks with their status, logs, and results.
 * This endpoint is used by the UI to display operation history and track progress.
 *
 * @param request - NextRequest with optional `interviewId` query parameter
 * @returns JSON response with operations array
 *
 * @example
 * ```typescript
 * // Get all operations
 * const response = await fetch('/api/operations')
 * const { operations } = await response.json()
 *
 * // Get operations for specific interview
 * const response = await fetch('/api/operations?interviewId=abc123')
 * const { operations } = await response.json()
 * ```
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const interviewId = url.searchParams.get('interviewId')

    if (interviewId) {
      // Get operations for a specific interview
      const operations = operationManager.getOperationsByInterview(interviewId)
      return NextResponse.json({ operations })
    } else {
      // Get all operations
      const operations = operationManager.getAllOperations()
      return NextResponse.json({ operations })
    }
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to get operations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
