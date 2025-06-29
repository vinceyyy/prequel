import { NextRequest } from 'next/server'
import { terraformManager } from '@/lib/terraform'

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
