import { NextRequest } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { candidateName, scenario } = body

    if (!candidateName || !scenario) {
      return new Response('candidateName and scenario are required', {
        status: 400,
      })
    }

    const interviewId = uuidv4().substring(0, 8)
    const password = Math.random().toString(36).substring(2, 12)

    const instance = {
      id: interviewId,
      candidateName,
      scenario,
      password,
    }

    // Create a ReadableStream for Server-Sent Events
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        // Send initial metadata
        const initialData = {
          type: 'metadata',
          interviewId,
          candidateName,
          scenario,
          password,
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`)
        )

        // Start Terraform provisioning with streaming
        terraformManager
          .createInterviewStreaming(instance, (data: string) => {
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
              accessUrl: result.accessUrl,
              error: result.error,
              executionLog: result.executionLog,
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
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        error: 'Failed to create interview stream',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
