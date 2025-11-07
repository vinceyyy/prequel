import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'
import { takehomeManager } from '@/lib/takehome'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: interviewId } = await params

    if (!interviewId) {
      return new Response('Interview ID is required', {
        status: 400,
      })
    }

    // Create a ReadableStream for Server-Sent Events
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        // Get interview details from the original create operation
        let candidateName: string | undefined
        let challenge: string | undefined
        let saveFiles: boolean | undefined

        try {
          const operations =
            await operationManager.getOperationsByInterview(interviewId)
          const createOperation = operations.find(
            op => op.type === 'create' && op.status === 'completed'
          )

          if (createOperation) {
            candidateName = createOperation.candidateName
            challenge = createOperation.challenge
            saveFiles = createOperation.saveFiles
          }
        } catch (error) {
          console.log(
            'Could not retrieve create operation details for streaming destroy:',
            error
          )
        }

        // Send initial metadata
        const initialData = {
          type: 'metadata',
          interviewId,
          action: 'destroy',
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`)
        )

        // Start interview destroy with streaming
        interviewManager
          .destroyInterviewWithInfrastructure(
            interviewId,
            (data: string) => {
              // Send streaming data
              const streamData = {
                type: 'output',
                data: data,
              }
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(streamData)}\n\n`)
              )
            },
            candidateName,
            challenge,
            saveFiles
          )
          .then(result => {
            // Send final result
            const finalData = {
              type: 'complete',
              success: result.success,
              error: result.error,
              historyS3Key: result.historyS3Key,
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`)
            )
            controller.close()
          })
          .catch(error => {
            // Send error result
            const errorData = {
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`)
            )
            controller.close()
          })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        error: 'Failed to create destroy stream',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: interviewId } = await params

    // Get interview details from the request body for better operation tracking
    let candidateName: string | undefined
    let challenge: string | undefined
    let saveFiles: boolean | undefined

    try {
      const body = await request.json()
      candidateName = body.candidateName
      challenge = body.challenge
    } catch {
      // If no body provided, operation will still work but without metadata
      console.log('No interview metadata provided in destroy request')
    }

    // Try to get interview details from the original create operation
    try {
      const operations =
        await operationManager.getOperationsByInterview(interviewId)
      const createOperation = operations.find(
        op => op.type === 'create' && op.status === 'completed'
      )

      if (createOperation) {
        candidateName = candidateName || createOperation.candidateName
        challenge = challenge || createOperation.challenge
        saveFiles = createOperation.saveFiles // Get saveFiles from create operation
      }
    } catch (error) {
      console.log('Could not retrieve create operation details:', error)
    }

    // Cancel any scheduled operations for this interview
    const cancelledCount =
      await operationManager.cancelScheduledOperationsForInterview(interviewId)
    if (cancelledCount > 0) {
      console.log(
        `Cancelled ${cancelledCount} scheduled operations for interview ${interviewId}`
      )
    }

    // Create operation to track progress
    const operationId = await operationManager.createOperation(
      'destroy',
      interviewId,
      candidateName,
      challenge
    )

    // Start background operation
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Starting interview destruction for ${interviewId}`
        )

        if (cancelledCount > 0) {
          await operationManager.addOperationLog(
            operationId,
            `Cancelled ${cancelledCount} scheduled operation(s) for this interview`
          )
        }

        const result =
          await interviewManager.destroyInterviewWithInfrastructure(
            interviewId,
            (data: string) => {
              // Add each line to operation logs
              const lines = data.split('\n').filter(line => line.trim())
              lines.forEach(line => {
                // Note: We can't await here since this is a streaming callback
                // Logs will be added asynchronously without blocking the stream
                operationManager
                  .addOperationLog(operationId, line)
                  .catch(console.error)
              })
            },
            candidateName,
            challenge,
            saveFiles
          )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Interview destroyed successfully!'
          )

          // Check if this is a take-home interview and mark complete
          if (interviewId.startsWith('takehome-')) {
            try {
              // Query for 'activated' status since running interviews have status='activated', not 'active'
              const takehomes = await takehomeManager.getActivatedTakehomes()
              const takehome = takehomes.find(
                t => t.interviewId === interviewId
              )
              if (takehome) {
                await takehomeManager.completeTakehome(takehome.passcode)
                await operationManager.addOperationLog(
                  operationId,
                  'Marked take-home test as completed'
                )
              }
            } catch (error) {
              console.error(
                'Failed to mark take-home test as completed:',
                error
              )
            }
          }

          await operationManager.setOperationResult(operationId, {
            success: true,
            fullOutput: result.fullOutput,
            historyS3Key: result.historyS3Key,
          })
        } else {
          await operationManager.addOperationLog(
            operationId,
            '❌ Interview destruction failed'
          )
          await operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          )

          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput,
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
        })
      }
    })

    return NextResponse.json({
      operationId,
      interviewId,
      message: 'Interview destruction started in background',
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to start interview destruction',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
