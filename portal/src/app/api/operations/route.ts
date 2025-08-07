import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

/**
 * Retrieves operations (background tasks) from the operation manager.
 *
 * Supports multiple query modes:
 * 1. Get all operations: `GET /api/operations` (uses table scan - slow for large datasets)
 * 2. Get operations for specific interview: `GET /api/operations?interviewId=abc123` (uses GSI - fast)
 * 3. Get only active operations: `GET /api/operations?activeOnly=true` (uses GSI - fast)
 *
 * Operations include create/destroy tasks with their status, logs, and results.
 * This endpoint is used by the UI to display operation history and track progress.
 *
 * @param request - NextRequest with optional `interviewId` or `activeOnly` query parameters
 * @returns JSON response with operations array
 *
 * @example
 * ```typescript
 * // Get all operations (slow - full table scan)
 * const response = await fetch('/api/operations')
 * const { operations } = await response.json()
 *
 * // Get only active operations (fast - GSI queries)
 * const response = await fetch('/api/operations?activeOnly=true')
 * const { operations } = await response.json()
 *
 * // Get operations for specific interview (fast - GSI query)
 * const response = await fetch('/api/operations?interviewId=abc123')
 * const { operations } = await response.json()
 * ```
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const interviewId = url.searchParams.get('interviewId')
    const activeOnly = url.searchParams.get('activeOnly') === 'true'

    if (interviewId) {
      // Get operations for a specific interview (uses GSI - fast)
      const operations =
        await operationManager.getOperationsByInterview(interviewId)
      return NextResponse.json({ operations })
    } else if (activeOnly) {
      // Get only active operations (uses GSI queries - fast)
      const operations = await operationManager.getActiveOperations()
      return NextResponse.json({ operations })
    } else {
      // Get all operations (uses table scan - slow for large datasets)
      console.warn(
        '[PERFORMANCE] Using full table scan for getAllOperations() - consider using activeOnly=true for better performance'
      )
      const operations = await operationManager.getAllOperations()
      return NextResponse.json({ operations })
    }
  } catch (error: unknown) {
    console.error('Error getting operations:', error)

    // Return empty array for any DynamoDB errors to prevent UI crashes
    return NextResponse.json({ operations: [] })
  }
}
