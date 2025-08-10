import { NextRequest, NextResponse } from 'next/server'
import { cleanupService } from '@/lib/cleanup'
import { logger } from '@/lib/logger'

/**
 * Administrative endpoint for cleaning up dangling AWS resources.
 *
 * This endpoint provides comprehensive cleanup capabilities for terraform workspaces
 * and AWS resources that may be left behind due to failed operations or corrupted state.
 *
 * **Security**: This is an administrative endpoint that should be protected in production.
 *
 * **Operations Supported:**
 * - GET: List dangling resources without cleaning them up (dry run)
 * - POST: Perform actual cleanup of dangling resources
 *
 * **Query Parameters:**
 * - `dryRun=true`: Preview what would be cleaned up without making changes
 * - `forceDestroy=true`: Clean up workspaces even if interviews exist in DynamoDB
 * - `maxConcurrency=3`: Maximum number of concurrent cleanup operations
 * - `timeout=300`: Timeout in seconds for each cleanup operation
 *
 * **Response Format:**
 * ```typescript
 * {
 *   success: boolean
 *   summary: {
 *     workspacesFound: number
 *     workspacesDestroyed: number
 *     workspacesSkipped: number
 *     workspacesErrored: number
 *     danglingResourcesFound: number
 *     danglingResourcesCleaned: number
 *   }
 *   details: string[]
 *   workspaceResults: Array<{
 *     interviewId: string
 *     status: 'destroyed' | 'skipped' | 'error'
 *     reason?: string
 *     error?: string
 *   }>
 * }
 * ```
 *
 * @example
 * ```bash
 * # Dry run to preview cleanup
 * curl "http://localhost:3000/api/admin/cleanup?dryRun=true"
 *
 * # Actual cleanup with limited concurrency
 * curl -X POST "http://localhost:3000/api/admin/cleanup?maxConcurrency=2&timeout=300"
 *
 * # Force cleanup including active interviews
 * curl -X POST "http://localhost:3000/api/admin/cleanup?forceDestroy=true"
 * ```
 */

/**
 * GET: List dangling resources without cleaning them up.
 *
 * This is equivalent to a dry run that shows what resources would be cleaned up
 * without actually performing any destructive operations.
 */
export async function GET() {
  try {
    logger.info('[Cleanup API] Listing dangling resources')

    const danglingResources = await cleanupService.listDanglingResources()

    logger.info('[Cleanup API] Found dangling resources', {
      totalWorkspaces: danglingResources.workspaces.length,
      existingInterviews: danglingResources.existingInterviews.length,
      danglingWorkspaces: danglingResources.danglingWorkspaces.length,
    })

    return NextResponse.json({
      success: true,
      message: 'Dangling resources listed successfully',
      data: {
        totalWorkspaces: danglingResources.workspaces.length,
        existingInterviews: danglingResources.existingInterviews.length,
        danglingWorkspaces: danglingResources.danglingWorkspaces.length,
        workspaces: danglingResources.workspaces,
        existingInterviewsList: danglingResources.existingInterviews,
        danglingWorkspacesList: danglingResources.danglingWorkspaces,
      },
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('[Cleanup API] Failed to list dangling resources', {
      error: errorMsg,
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to list dangling resources',
        details: errorMsg,
      },
      { status: 500 }
    )
  }
}

/**
 * POST: Perform cleanup of dangling resources.
 *
 * This endpoint performs the actual cleanup operation, destroying terraform
 * infrastructure and removing workspace files from S3.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const dryRun = searchParams.get('dryRun') === 'true'
    const forceDestroy = searchParams.get('forceDestroy') === 'true'
    const maxConcurrency = parseInt(
      searchParams.get('maxConcurrency') || '3',
      10
    )
    const timeout = parseInt(searchParams.get('timeout') || '300', 10)

    // Validate parameters
    if (maxConcurrency < 1 || maxConcurrency > 10) {
      return NextResponse.json(
        {
          success: false,
          error: 'maxConcurrency must be between 1 and 10',
        },
        { status: 400 }
      )
    }

    if (timeout < 60 || timeout > 1800) {
      return NextResponse.json(
        {
          success: false,
          error: 'timeout must be between 60 and 1800 seconds',
        },
        { status: 400 }
      )
    }

    logger.info('[Cleanup API] Starting cleanup operation', {
      dryRun,
      forceDestroy,
      maxConcurrency,
      timeout,
    })

    // Perform cleanup
    const result = await cleanupService.performCleanup({
      dryRun,
      forceDestroy,
      maxConcurrency,
      timeout,
    })

    logger.info('[Cleanup API] Cleanup operation completed', result.summary)

    // Determine response status
    const status = result.success ? 200 : 207 // 207 = Multi-Status (partial success)

    return NextResponse.json(
      {
        success: result.success,
        message: result.success
          ? 'Cleanup completed successfully'
          : 'Cleanup completed with some errors',
        error: result.error,
        summary: result.summary,
        details: result.details,
        workspaceResults: result.workspaceResults,
      },
      { status }
    )
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('[Cleanup API] Cleanup operation failed', { error: errorMsg })

    return NextResponse.json(
      {
        success: false,
        error: 'Cleanup operation failed',
        details: errorMsg,
      },
      { status: 500 }
    )
  }
}

/**
 * OPTIONS: CORS preflight handler.
 */
export async function OPTIONS() {
  return NextResponse.json(
    { methods: ['GET', 'POST'] },
    {
      headers: {
        Allow: 'GET, POST, OPTIONS',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    }
  )
}
