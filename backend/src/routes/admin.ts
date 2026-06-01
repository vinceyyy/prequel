import { Hono } from 'hono'
import { cleanupService } from '../lib/cleanup'
import { logger } from '../lib/logger'

export const adminRouter = new Hono()

/**
 * GET /api/admin/cleanup — list dangling resources without cleaning them up.
 *
 * This is equivalent to a dry run that shows what resources would be cleaned up
 * without actually performing any destructive operations.
 */
adminRouter.get('/cleanup', async (c) => {
  try {
    logger.info('[Cleanup API] Listing dangling resources')

    const danglingResources = await cleanupService.listDanglingResources()

    logger.info('[Cleanup API] Found dangling resources', {
      totalWorkspaces: danglingResources.workspaces.length,
      existingInterviews: danglingResources.existingInterviews.length,
      danglingWorkspaces: danglingResources.danglingWorkspaces.length,
    })

    return c.json({
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

    return c.json(
      {
        success: false,
        error: 'Failed to list dangling resources',
        details: errorMsg,
      },
      500,
    )
  }
})

/**
 * POST /api/admin/cleanup — perform cleanup of dangling resources.
 *
 * This endpoint performs the actual cleanup operation, destroying terraform
 * infrastructure and removing workspace files from S3.
 *
 * Query Parameters:
 * - `dryRun=true`: Preview what would be cleaned up without making changes
 * - `forceDestroy=true`: Clean up workspaces even if interviews exist in DynamoDB
 * - `maxConcurrency=3`: Maximum number of concurrent cleanup operations
 * - `timeout=300`: Timeout in seconds for each cleanup operation
 */
adminRouter.post('/cleanup', async (c) => {
  try {
    // Parse query parameters
    const dryRun = c.req.query('dryRun') === 'true'
    const forceDestroy = c.req.query('forceDestroy') === 'true'
    const maxConcurrency = parseInt(c.req.query('maxConcurrency') || '3', 10)
    const timeout = parseInt(c.req.query('timeout') || '300', 10)

    // Validate parameters
    if (maxConcurrency < 1 || maxConcurrency > 10) {
      return c.json(
        {
          success: false,
          error: 'maxConcurrency must be between 1 and 10',
        },
        400,
      )
    }

    if (timeout < 60 || timeout > 1800) {
      return c.json(
        {
          success: false,
          error: 'timeout must be between 60 and 1800 seconds',
        },
        400,
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

    return c.json(
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
      status,
    )
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('[Cleanup API] Cleanup operation failed', { error: errorMsg })

    return c.json(
      {
        success: false,
        error: 'Cleanup operation failed',
        details: errorMsg,
      },
      500,
    )
  }
})
