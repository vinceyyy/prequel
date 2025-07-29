import { operationManager } from './operations'
import { terraformManager } from './terraform'
import { schedulerLogger } from './logger'

/**
 * Background scheduler service for processing scheduled operations and auto-destroy timeouts.
 *
 * This service runs continuously in the background (30-second polling interval) to:
 * 1. Process scheduled interview creation/destruction operations from DynamoDB
 * 2. Handle auto-destroy timeouts for active interviews
 * 3. Emit events for SSE clients to track scheduler activities
 *
 * The scheduler ensures that interviews are created/destroyed at their scheduled times
 * and prevents resource waste by automatically cleaning up expired interviews.
 *
 * Key Features:
 * - **Scheduled Operations**: Executes operations at their scheduled time using DynamoDB queries
 * - **Auto-destroy**: Mandatory cleanup of interviews after timeout with duplicate prevention
 * - **Event Emission**: SSE events for real-time scheduler status
 * - **Error Handling**: Robust error handling with detailed logging
 * - **DynamoDB Integration**: Uses efficient GSI queries for scalable operation lookup
 *
 * @example
 * ```typescript
 * // Listen for scheduler events
 * scheduler.addEventListener((event) => {
 *   if (event.type === 'auto_destroy_triggered') {
 *     console.log(`Auto-destroying interview ${event.interviewId}`)
 *   }
 * })
 * ```
 */
export class SchedulerService {
  private checkInterval: NodeJS.Timeout | null = null
  private eventListeners: ((event: SchedulerEvent) => void)[] = []

  constructor() {
    this.start()
  }

  /**
   * Starts the scheduler service with 30-second polling interval.
   * Automatically called in constructor.
   */
  start() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }

    // Check every 30 seconds for scheduled operations
    this.checkInterval = setInterval(() => {
      this.processScheduledOperations()
      this.processAutoDestroyOperations()
    }, 30000)

    schedulerLogger.info('Scheduler service started')
  }

  /**
   * Stops the scheduler service and clears the polling interval.
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    schedulerLogger.info('Scheduler service stopped')
  }

  /**
   * Adds an event listener for scheduler events.
   * @param listener - Function to call when scheduler events occur
   */
  addEventListener(listener: (event: SchedulerEvent) => void) {
    this.eventListeners.push(listener)
  }

  /**
   * Removes an event listener.
   * @param listener - The listener function to remove
   */
  removeEventListener(listener: (event: SchedulerEvent) => void) {
    const index = this.eventListeners.indexOf(listener)
    if (index > -1) {
      this.eventListeners.splice(index, 1)
    }
  }

  /**
   * Emits a scheduler event to all registered listeners.
   * @param event - The scheduler event to emit
   */
  private emit(event: SchedulerEvent) {
    this.eventListeners.forEach(listener => {
      try {
        listener(event)
      } catch (error) {
        schedulerLogger.error('Error in scheduler event listener', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })
  }

  /**
   * Processes operations scheduled to start at or before the current time.
   * Called every 30 seconds to check for due operations.
   *
   * Uses DynamoDB GSI to efficiently query operations with 'scheduled' status.
   */
  private async processScheduledOperations() {
    try {
      const scheduledOps = await operationManager.getScheduledOperations()
      const now = new Date()

      if (scheduledOps.length > 0) {
        schedulerLogger.debug(
          `Found ${scheduledOps.length} scheduled operations to check`
        )
      }

      for (const operation of scheduledOps) {
        if (operation.scheduledAt && operation.scheduledAt <= now) {
          schedulerLogger.info('Processing scheduled operation', {
            operationId: operation.id,
            interviewId: operation.interviewId,
            type: operation.type,
            candidateName: operation.candidateName,
          })

          try {
            if (
              operation.type === 'create' &&
              operation.candidateName &&
              operation.challenge
            ) {
              await this.executeScheduledCreate({
                id: operation.id,
                interviewId: operation.interviewId,
                candidateName: operation.candidateName,
                challenge: operation.challenge,
              })
            } else if (operation.type === 'destroy') {
              await this.executeScheduledDestroy({
                id: operation.id,
                interviewId: operation.interviewId,
                candidateName: operation.candidateName,
                challenge: operation.challenge,
                saveFiles: operation.saveFiles,
              })
            }
          } catch (error) {
            schedulerLogger.error('Error processing scheduled operation', {
              operationId: operation.id,
              interviewId: operation.interviewId,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
            await operationManager.addOperationLog(
              operation.id,
              `❌ Scheduler error: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
            await operationManager.updateOperationStatus(operation.id, 'failed')
          }
        }
      }
    } catch (error) {
      // Handle DynamoDB throttling gracefully
      if (error instanceof Error && error.name === 'ThrottlingException') {
        schedulerLogger.warn(
          'DynamoDB throttling during scheduled operations check - will retry next cycle'
        )
      } else {
        schedulerLogger.error('Error in processScheduledOperations', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  /**
   * Processes interviews that have reached their auto-destroy timeout.
   * Creates destroy operations for expired interviews to prevent resource waste.
   * Called every 30 seconds to check for expired interviews.
   *
   * Uses DynamoDB GSI queries for efficient lookup of operations eligible for auto-destroy.
   * Includes built-in duplicate prevention to avoid creating multiple destroy operations.
   */
  private async processAutoDestroyOperations() {
    try {
      const autoDestroyOps =
        await operationManager.getOperationsForAutoDestroy()

      if (autoDestroyOps.length > 0) {
        schedulerLogger.debug(
          `Found ${autoDestroyOps.length} operations eligible for auto-destroy`
        )
      }

      for (const operation of autoDestroyOps) {
        schedulerLogger.info('Auto-destroying interview', {
          interviewId: operation.interviewId,
          operationId: operation.id,
          candidateName: operation.candidateName,
          autoDestroyAt: operation.autoDestroyAt?.toISOString(),
        })

        try {
          // Create a new destroy operation for the auto-destroy
          const destroyOpId = await operationManager.createOperation(
            'destroy',
            operation.interviewId,
            operation.candidateName,
            operation.challenge
          )

          const destroyOp = await operationManager.getOperation(destroyOpId)
          if (destroyOp) {
            await this.executeScheduledDestroy({
              id: destroyOp.id,
              interviewId: destroyOp.interviewId,
              candidateName: destroyOp.candidateName,
              challenge: destroyOp.challenge,
              saveFiles: destroyOp.saveFiles,
            })
          }

          this.emit({
            type: 'auto_destroy_triggered',
            operationId: destroyOpId,
            interviewId: operation.interviewId,
            originalOperationId: operation.id,
          })
        } catch (error) {
          schedulerLogger.error('Error auto-destroying interview', {
            interviewId: operation.interviewId,
            operationId: operation.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    } catch (error) {
      // Handle DynamoDB throttling gracefully
      if (error instanceof Error && error.name === 'ThrottlingException') {
        schedulerLogger.warn(
          'DynamoDB throttling during auto-destroy check - will retry next cycle'
        )
      } else {
        schedulerLogger.error('Error in processAutoDestroyOperations', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  private async executeScheduledCreate(operation: {
    id: string
    interviewId: string
    candidateName: string
    challenge: string
  }) {
    await operationManager.updateOperationStatus(operation.id, 'running')
    await operationManager.addOperationLog(
      operation.id,
      `🕐 Scheduled interview creation starting for ${operation.candidateName}`
    )

    this.emit({
      type: 'scheduled_create_started',
      operationId: operation.id,
      interviewId: operation.interviewId,
    })

    const instance = {
      id: operation.interviewId,
      candidateName: operation.candidateName,
      challenge: operation.challenge,
      password: Math.random().toString(36).substring(2, 12),
    }

    try {
      const result = await terraformManager.createInterviewStreaming(
        instance,
        (data: string) => {
          const lines = data.split('\n').filter(line => line.trim())
          lines.forEach(line => {
            // Note: We can't await here since this is a streaming callback
            // Logs will be added asynchronously without blocking the stream
            operationManager
              .addOperationLog(operation.id, line)
              .catch(console.error)
          })
        }
      )

      if (result.success) {
        await operationManager.addOperationLog(
          operation.id,
          '✅ Scheduled interview created successfully!'
        )
        await operationManager.addOperationLog(
          operation.id,
          `Access URL: ${result.accessUrl}`
        )

        await operationManager.setOperationResult(operation.id, {
          success: true,
          accessUrl: result.accessUrl,
          password: instance.password,
          fullOutput: result.fullOutput,
          healthCheckPassed: result.healthCheckPassed,
        })

        this.emit({
          type: 'scheduled_create_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: true,
          accessUrl: result.accessUrl,
        })
      } else {
        await operationManager.addOperationLog(
          operation.id,
          '❌ Scheduled interview creation failed'
        )
        await operationManager.addOperationLog(
          operation.id,
          `Error: ${result.error}`
        )

        await operationManager.setOperationResult(operation.id, {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput,
        })

        this.emit({
          type: 'scheduled_create_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: false,
          error: result.error,
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      await operationManager.addOperationLog(
        operation.id,
        `❌ Error: ${errorMsg}`
      )
      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: errorMsg,
      })

      this.emit({
        type: 'scheduled_create_completed',
        operationId: operation.id,
        interviewId: operation.interviewId,
        success: false,
        error: errorMsg,
      })
    }
  }

  private async executeScheduledDestroy(operation: {
    id: string
    interviewId: string
    candidateName?: string
    challenge?: string
    saveFiles?: boolean
  }) {
    await operationManager.updateOperationStatus(operation.id, 'running')
    await operationManager.addOperationLog(
      operation.id,
      `🕐 Scheduled interview destruction starting for ${operation.candidateName || operation.interviewId}`
    )

    this.emit({
      type: 'scheduled_destroy_started',
      operationId: operation.id,
      interviewId: operation.interviewId,
    })

    try {
      const result = await terraformManager.destroyInterviewStreaming(
        operation.interviewId,
        (data: string) => {
          const lines = data.split('\n').filter(line => line.trim())
          lines.forEach(line => {
            // Note: We can't await here since this is a streaming callback
            // Logs will be added asynchronously without blocking the stream
            operationManager
              .addOperationLog(operation.id, line)
              .catch(console.error)
          })
        },
        operation.candidateName,
        operation.challenge,
        operation.saveFiles
      )

      if (result.success) {
        await operationManager.addOperationLog(
          operation.id,
          '✅ Scheduled interview destroyed successfully!'
        )
        await operationManager.setOperationResult(operation.id, {
          success: true,
          historyS3Key: result.historyS3Key,
          fullOutput: result.fullOutput,
        })

        this.emit({
          type: 'scheduled_destroy_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: true,
        })
      } else {
        await operationManager.addOperationLog(
          operation.id,
          '❌ Scheduled interview destruction failed'
        )
        await operationManager.addOperationLog(
          operation.id,
          `Error: ${result.error}`
        )

        await operationManager.setOperationResult(operation.id, {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput,
        })

        this.emit({
          type: 'scheduled_destroy_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: false,
          error: result.error,
        })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      await operationManager.addOperationLog(
        operation.id,
        `❌ Error: ${errorMsg}`
      )
      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: errorMsg,
      })

      this.emit({
        type: 'scheduled_destroy_completed',
        operationId: operation.id,
        interviewId: operation.interviewId,
        success: false,
        error: errorMsg,
      })
    }
  }
}

export interface SchedulerEvent {
  type:
    | 'scheduled_create_started'
    | 'scheduled_create_completed'
    | 'scheduled_destroy_started'
    | 'scheduled_destroy_completed'
    | 'auto_destroy_triggered'
  operationId: string
  interviewId: string
  originalOperationId?: string
  success?: boolean
  error?: string
  accessUrl?: string
}

// Global scheduler instance
export const scheduler = new SchedulerService()
