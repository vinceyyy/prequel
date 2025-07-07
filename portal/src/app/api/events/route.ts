import { NextRequest } from 'next/server'
import { operationManager } from '@/lib/operations'
import { scheduler, type SchedulerEvent } from '@/lib/scheduler'

export async function GET(request: NextRequest) {
  // Create a readable stream for SSE
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const data = JSON.stringify({
        type: 'connection',
        timestamp: new Date().toISOString(),
      })
      controller.enqueue(encoder.encode(`data: ${data}\n\n`))

      // Set up periodic heartbeat
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          })
          controller.enqueue(encoder.encode(`data: ${heartbeat}\n\n`))
        } catch (error) {
          console.error('Error sending heartbeat:', error)
          clearInterval(heartbeatInterval)
        }
      }, 30000) // Send heartbeat every 30 seconds

      // Set up periodic operation status updates
      const statusInterval = setInterval(() => {
        try {
          const operations = operationManager.getAllOperations()
          const activeOperations = operations.filter(
            op => op.status === 'running' || op.status === 'scheduled'
          )

          if (activeOperations.length > 0) {
            const statusUpdate = JSON.stringify({
              type: 'operation_status',
              timestamp: new Date().toISOString(),
              operations: activeOperations.map(op => ({
                id: op.id,
                type: op.type,
                status: op.status,
                interviewId: op.interviewId,
                candidateName: op.candidateName,
                scheduledAt: op.scheduledAt,
                autoDestroyAt: op.autoDestroyAt,
              })),
            })
            controller.enqueue(encoder.encode(`data: ${statusUpdate}\n\n`))
          }
        } catch (error) {
          console.error('Error sending status update:', error)
        }
      }, 5000) // Check every 5 seconds

      // Listen for scheduler events
      const schedulerEventListener = (event: SchedulerEvent) => {
        try {
          const eventData = JSON.stringify({
            type: 'scheduler_event',
            timestamp: new Date().toISOString(),
            event,
          })
          controller.enqueue(encoder.encode(`data: ${eventData}\n\n`))
        } catch (error) {
          console.error('Error sending scheduler event:', error)
        }
      }

      scheduler.addEventListener(schedulerEventListener)

      // Clean up on close
      const cleanup = () => {
        clearInterval(heartbeatInterval)
        clearInterval(statusInterval)
        scheduler.removeEventListener(schedulerEventListener)
        try {
          controller.close()
        } catch (error) {
          console.error('Error closing SSE controller:', error)
        }
      }

      // Handle client disconnect
      request.signal.addEventListener('abort', cleanup)

      // Store cleanup function for potential use
      ;(controller as unknown as Record<string, unknown>)._cleanup = cleanup
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  })
}
