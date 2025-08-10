import { NextRequest } from 'next/server'
import { operationManager, type OperationEvent } from '@/lib/operations'
import { scheduler, type SchedulerEvent } from '@/lib/scheduler'

/**
 * Server-Sent Events (SSE) endpoint for real-time updates.
 *
 * Provides a persistent connection that streams real-time events to clients including:
 * - Connection acknowledgment
 * - Periodic heartbeats (every 30 seconds)
 * - Operation status updates (every 15 seconds for active operations via efficient GSI queries)
 * - Immediate operation state changes
 * - Scheduler events for background processing
 *
 * Event Types:
 * - `connection`: Initial connection acknowledgment
 * - `heartbeat`: Keep-alive ping every 30 seconds
 * - `operation_status`: Periodic status of active/scheduled operations (every 15 seconds)
 * - `operation_update`: Immediate updates when operations change state
 * - `scheduler_event`: Background scheduler processing notifications
 *
 * The connection automatically cleans up when the client disconnects.
 *
 * @param request - NextRequest object (used for abort signal detection)
 * @returns Response with text/event-stream content type for SSE
 */
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

      // Set up periodic operation status updates - using efficient GSI queries instead of full table scan
      const statusInterval = setInterval(async () => {
        try {
          // Use efficient GSI queries instead of scanning all operations
          const activeOperations = await operationManager.getActiveOperations()

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
      }, 15000) // Reduced frequency: Check every 15 seconds instead of 5 seconds

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

      // Listen for operation events (status changes and log updates)
      const operationEventListener = (event: OperationEvent) => {
        try {
          if (event.type === 'operation_update' && event.operation) {
            const eventData = JSON.stringify({
              type: 'operation_update',
              timestamp: new Date().toISOString(),
              operation: {
                id: event.operation.id,
                type: event.operation.type,
                status: event.operation.status,
                interviewId: event.operation.interviewId,
                candidateName: event.operation.candidateName,
                challenge: event.operation.challenge,
                scheduledAt: event.operation.scheduledAt,
                autoDestroyAt: event.operation.autoDestroyAt,
                createdAt: event.operation.createdAt,
                executionStartedAt: event.operation.executionStartedAt,
                completedAt: event.operation.completedAt,
                result: event.operation.result,
              },
            })
            controller.enqueue(encoder.encode(`data: ${eventData}\n\n`))
          } else if (event.type === 'operation_logs') {
            // Send log update events for real-time log streaming
            const eventData = JSON.stringify({
              type: 'operation_logs',
              timestamp: new Date().toISOString(),
              operationId: event.operationId,
              logs: event.logs,
            })
            controller.enqueue(encoder.encode(`data: ${eventData}\n\n`))
          }
        } catch (error) {
          console.error('Error sending operation event:', error)
        }
      }

      scheduler.addEventListener(schedulerEventListener)
      operationManager.addEventListener(operationEventListener)

      // Clean up on close
      const cleanup = () => {
        clearInterval(heartbeatInterval)
        clearInterval(statusInterval)
        scheduler.removeEventListener(schedulerEventListener)
        operationManager.removeEventListener(operationEventListener)
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
