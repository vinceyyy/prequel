import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'

/**
 * Retries health check for an interview instance.
 *
 * This endpoint is used when an interview infrastructure was created successfully
 * but the initial health check failed (ECS service not yet ready). It attempts
 * to check if the service has become healthy since the initial creation.
 *
 * The health check verifies that the VS Code server is accessible and responding
 * to HTTP requests. If successful, it updates the original operation result to
 * mark the health check as passed, changing the interview status to "active".
 *
 * @param request - NextRequest object (unused)
 * @param params - Route parameters containing the interview ID
 * @returns JSON response with operation ID for tracking the retry progress
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/interviews/abc123/health-check', {
 *   method: 'POST'
 * })
 * const { operationId } = await response.json()
 * // Use operationId to track retry progress via SSE or operation API
 * ```
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: interviewId } = await params

    if (!interviewId) {
      return NextResponse.json(
        { error: 'Interview ID is required' },
        { status: 400 }
      )
    }

    // Find the create operation for this interview
    const operations =
      await operationManager.getOperationsByInterview(interviewId)
    const createOperation = operations.find(op => op.type === 'create')

    if (!createOperation) {
      return NextResponse.json(
        { error: 'No create operation found for this interview' },
        { status: 404 }
      )
    }

    if (
      createOperation.status !== 'completed' ||
      !createOperation.result?.success
    ) {
      return NextResponse.json(
        { error: 'Interview creation is not completed successfully' },
        { status: 400 }
      )
    }

    // Create a new operation to track the health check retry
    const operationId = await operationManager.createOperation(
      'create',
      interviewId,
      createOperation.candidateName,
      createOperation.challenge
    )

    // Start background health check retry
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Retrying health check for interview ${interviewId}`
        )

        const result = await terraformManager.retryHealthCheck(
          interviewId,
          (data: string) => {
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              // Note: We can't await here since this is a streaming callback
              // Logs will be added asynchronously without blocking the stream
              operationManager
                .addOperationLog(operationId, line)
                .catch(console.error)
            })
          }
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Health check retry successful!'
          )

          // Update the original operation's result to mark health check as passed
          const originalResult = createOperation.result
          if (originalResult) {
            originalResult.healthCheckPassed = true
            await operationManager.setOperationResult(
              createOperation.id,
              originalResult
            )
          }

          await operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: createOperation.result?.password,
            healthCheckPassed: true,
          })
        } else {
          await operationManager.addOperationLog(
            operationId,
            '❌ Health check retry failed'
          )
          await operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          )

          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            healthCheckPassed: false,
          })
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        await operationManager.addOperationLog(
          operationId,
          `❌ Error: ${errorMsg}`
        )
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg,
          healthCheckPassed: false,
        })
      }
    })

    return NextResponse.json({
      operationId,
      interviewId,
      message: 'Health check retry started in background',
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to start health check retry',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
