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

    // Create operation to track progress
    const operationId = operationManager.createOperation('destroy', interviewId)

    // Start background operation
    setImmediate(async () => {
      try {
        operationManager.updateOperationStatus(operationId, 'running')
        operationManager.addOperationLog(
          operationId,
          `Starting interview destruction for ${interviewId}`
        )

        const result = await terraformManager.destroyInterviewStreaming(
          interviewId,
          (data: string) => {
            // Add each line to operation logs
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              operationManager.addOperationLog(operationId, line)
            })
          }
        )

        if (result.success) {
          operationManager.addOperationLog(
            operationId,
            '✅ Interview destroyed successfully!'
          )

          operationManager.setOperationResult(operationId, {
            success: true,
            fullOutput: result.fullOutput,
          })
        } else {
          operationManager.addOperationLog(
            operationId,
            '❌ Interview destruction failed'
          )
          operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          )

          operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput,
          })
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        operationManager.addOperationLog(operationId, `❌ Error: ${errorMsg}`)
        operationManager.setOperationResult(operationId, {
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
