import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'

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
    const operations = operationManager.getOperationsByInterview(interviewId)
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
    const operationId = operationManager.createOperation(
      'create',
      interviewId,
      createOperation.candidateName,
      createOperation.challenge
    )

    // Start background health check retry
    setImmediate(async () => {
      try {
        operationManager.updateOperationStatus(operationId, 'running')
        operationManager.addOperationLog(
          operationId,
          `Retrying health check for interview ${interviewId}`
        )

        const result = await terraformManager.retryHealthCheck(
          interviewId,
          (data: string) => {
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              operationManager.addOperationLog(operationId, line)
            })
          }
        )

        if (result.success) {
          operationManager.addOperationLog(
            operationId,
            '✅ Health check retry successful!'
          )

          // Update the original operation's result to mark health check as passed
          const originalResult = createOperation.result
          if (originalResult) {
            originalResult.healthCheckPassed = true
            operationManager.setOperationResult(
              createOperation.id,
              originalResult
            )
          }

          operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: createOperation.result?.password,
            healthCheckPassed: true,
          })
        } else {
          operationManager.addOperationLog(
            operationId,
            '❌ Health check retry failed'
          )
          operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          )

          operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            healthCheckPassed: false,
          })
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        operationManager.addOperationLog(operationId, `❌ Error: ${errorMsg}`)
        operationManager.setOperationResult(operationId, {
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
