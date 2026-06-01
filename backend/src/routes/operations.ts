import { Hono } from 'hono'
import { operationManager } from '../lib/operations'

export const operationsRouter = new Hono()

/**
 * GET /api/operations — retrieves operations (background tasks) from the
 * operation manager.
 *
 * Supports multiple query modes:
 * 1. Get all operations: `GET /api/operations` (uses table scan - slow for large datasets)
 * 2. Get operations for specific interview: `GET /api/operations?interviewId=abc123` (uses GSI - fast)
 * 3. Get only active operations: `GET /api/operations?activeOnly=true` (uses GSI - fast)
 */
operationsRouter.get('/', async (c) => {
  try {
    const interviewId = c.req.query('interviewId')
    const activeOnly = c.req.query('activeOnly') === 'true'

    if (interviewId) {
      // Get operations for a specific interview (uses GSI - fast)
      const operations =
        await operationManager.getOperationsByInterview(interviewId)
      return c.json({ operations })
    } else if (activeOnly) {
      // Get only active operations (uses GSI queries - fast)
      const operations = await operationManager.getActiveOperations()
      return c.json({ operations })
    } else {
      // Get all operations (uses table scan - slow for large datasets)
      console.warn(
        '[PERFORMANCE] Using full table scan for getAllOperations() - consider using activeOnly=true for better performance'
      )
      const operations = await operationManager.getAllOperations()
      return c.json({ operations })
    }
  } catch (error: unknown) {
    console.error('Error getting operations:', error)

    // Return empty array for any DynamoDB errors to prevent UI crashes
    return c.json({ operations: [] })
  }
})

/**
 * POST /api/operations/:id/cancel — cancels a running or pending operation.
 *
 * Only operations with status 'pending', 'running', or 'scheduled' can be
 * cancelled. Once cancelled, the operation status changes to 'cancelled' and
 * it will not execute.
 *
 * Note: This cancels the operation tracking but may not stop already
 * running infrastructure operations (like Terraform commands).
 */
operationsRouter.post('/:id/cancel', async (c) => {
  try {
    const id = c.req.param('id')
    const operationId = id

    if (!operationId) {
      return c.json(
        { success: false, error: 'Operation ID is required' },
        400
      )
    }

    const operation = await operationManager.getOperation(operationId)
    if (!operation) {
      return c.json(
        { success: false, error: 'Operation not found' },
        404
      )
    }

    // Check if operation can be cancelled
    if (
      operation.status !== 'pending' &&
      operation.status !== 'running' &&
      operation.status !== 'scheduled'
    ) {
      return c.json(
        {
          success: false,
          error: `Cannot cancel operation with status: ${operation.status}`,
        },
        400
      )
    }

    const cancelled = await operationManager.cancelOperation(operationId)

    if (cancelled) {
      return c.json({
        success: true,
        message: 'Operation cancelled successfully',
        operation: await operationManager.getOperation(operationId),
      })
    } else {
      return c.json(
        { success: false, error: 'Failed to cancel operation' },
        500
      )
    }
  } catch (error) {
    console.error('Error cancelling operation:', error)
    return c.json(
      { success: false, error: 'Internal server error' },
      500
    )
  }
})

/**
 * GET /api/operations/:id/logs — retrieves execution logs for a specific
 * operation.
 *
 * Supports incremental log fetching using the `from` query parameter.
 * This allows the UI to fetch only new logs since the last request,
 * enabling efficient real-time log streaming and reducing bandwidth.
 */
operationsRouter.get('/:id/logs', async (c) => {
  try {
    const id = c.req.param('id')
    const operationId = id
    const operation = await operationManager.getOperation(operationId)

    if (!operation) {
      return c.json({ error: 'Operation not found' }, 404)
    }

    const fromIndex = parseInt(c.req.query('from') || '0')

    // Return logs from a specific index (for incremental fetching)
    const logs = operation.logs.slice(fromIndex)

    return c.json({
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
    return c.json(
      {
        error: 'Failed to get operation logs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/operations/:id — retrieves a specific operation by its ID.
 *
 * Returns detailed information about a background operation including its
 * status, execution logs, results, and timing information.
 */
operationsRouter.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const operationId = id
    const operation = await operationManager.getOperation(operationId)

    if (!operation) {
      return c.json({ error: 'Operation not found' }, 404)
    }

    return c.json({ operation })
  } catch (error: unknown) {
    console.error('Error getting operation:', error)

    // Return 404 for any DynamoDB errors
    return c.json({ error: 'Operation not found' }, 404)
  }
})
