import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'

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
      start(controller) {
        const encoder = new TextEncoder()

        // Send initial metadata
        const initialData = {
          type: 'metadata',
          interviewId,
          action: 'destroy',
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`)
        )

        // Start Terraform destroy with streaming
        terraformManager
          .destroyInterviewStreaming(interviewId, (data: string) => {
            // Send streaming data
            const streamData = {
              type: 'output',
              data: data,
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(streamData)}\n\n`)
            )
          })
          .then(result => {
            // Send final result
            const finalData = {
              type: 'complete',
              success: result.success,
              error: result.error,
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

    try {
      const body = await request.json()
      candidateName = body.candidateName
      challenge = body.challenge
    } catch {
      // If no body provided, operation will still work but without metadata
      console.log('No interview metadata provided in destroy request')
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

        const result = await terraformManager.destroyInterviewStreaming(
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
          }
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Interview destroyed successfully!'
          )

          await operationManager.setOperationResult(operationId, {
            success: true,
            fullOutput: result.fullOutput,
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
