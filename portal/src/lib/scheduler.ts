import { operationManager } from './operations'
import { interviewManager } from './interviews'
import { schedulerLogger } from './logger'
import { config } from './config'
import { openaiService } from './openai'

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
   * **Pre-provisioning Strategy:**
   * Starts provisioning 5 minutes before the scheduled time to ensure the
   * instance is active and ready exactly at the scheduled time.
   *
   * Timeline example:
   * - Scheduled time: 2:00 PM
   * - Provisioning starts: 1:55 PM (5 minutes early)
   * - Instance active: ~1:58-2:00 PM (ready at scheduled time)
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
        if (operation.scheduledAt) {
          // Start provisioning 5 minutes before scheduled time to ensure instance is ready
          const provisioningTime = new Date(
            operation.scheduledAt.getTime() - 5 * 60 * 1000
          )

          if (provisioningTime <= now) {
            schedulerLogger.info('Processing scheduled operation', {
              operationId: operation.id,
              interviewId: operation.interviewId,
              type: operation.type,
              candidateName: operation.candidateName,
              scheduledAt: operation.scheduledAt.toISOString(),
              provisioningStartTime: provisioningTime.toISOString(),
              minutesBeforeScheduled: Math.round(
                (operation.scheduledAt.getTime() - now.getTime()) / 60000
              ),
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
              await operationManager.updateOperationStatus(
                operation.id,
                'failed'
              )
            }
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
   * **Dual-source Auto-destroy Strategy:**
   * 1. Check operations table for operations-based auto-destroy (legacy)
   * 2. Check DynamoDB interviews table for interview-based auto-destroy (new)
   *
   * This ensures comprehensive coverage during the transition period and prevents
   * resource leaks from either source.
   */
  private async processAutoDestroyOperations() {
    try {
      // Process operations-based auto-destroy (legacy approach)
      await this.processOperationsAutoDestroy()

      // Process DynamoDB interviews auto-destroy (new approach)
      await this.processInterviewsAutoDestroy()
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

  /**
   * Processes operations-based auto-destroy (legacy approach).
   * Looks for completed create operations that have reached their auto-destroy timeout.
   */
  private async processOperationsAutoDestroy() {
    try {
      const autoDestroyOps =
        await operationManager.getOperationsForAutoDestroy()

      if (autoDestroyOps.length > 0) {
        schedulerLogger.debug(
          `Found ${autoDestroyOps.length} operations eligible for auto-destroy`
        )
      }

      for (const operation of autoDestroyOps) {
        schedulerLogger.info('Auto-destroying interview (via operations)', {
          interviewId: operation.interviewId,
          operationId: operation.id,
          candidateName: operation.candidateName,
          autoDestroyAt: operation.autoDestroyAt?.toISOString(),
        })

        try {
          // Create a new destroy operation for the auto-destroy
          // Inherit saveFiles from the original operation to ensure file extraction happens
          const destroyOpId = await operationManager.createOperation(
            'destroy',
            operation.interviewId,
            operation.candidateName,
            operation.challenge,
            undefined, // scheduledAt
            undefined, // autoDestroyAt
            operation.saveFiles // Inherit saveFiles setting from original operation
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
          schedulerLogger.error(
            'Error auto-destroying interview (operations)',
            {
              interviewId: operation.interviewId,
              operationId: operation.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          )
        }
      }
    } catch (error) {
      schedulerLogger.error('Error in processOperationsAutoDestroy', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Processes DynamoDB interviews auto-destroy (new approach).
   * Looks for active interviews that have reached their auto-destroy timeout.
   */
  private async processInterviewsAutoDestroy() {
    try {
      // Get active interviews from DynamoDB
      const activeInterviews = await interviewManager.getActiveInterviews()
      const now = new Date()

      // Filter interviews that need auto-destroy
      const expiredInterviews = activeInterviews.filter(
        interview =>
          interview.autoDestroyAt &&
          interview.autoDestroyAt <= now &&
          interview.status === 'active' // Only destroy active interviews
      )

      if (expiredInterviews.length > 0) {
        schedulerLogger.debug(
          `Found ${expiredInterviews.length} interviews eligible for auto-destroy from DynamoDB`
        )
      }

      for (const interview of expiredInterviews) {
        // Check if there's already a destroy operation in progress for this interview
        const operations = await operationManager.getOperationsByInterview(
          interview.id
        )
        const hasActiveDestroy = operations.some(
          op =>
            op.type === 'destroy' &&
            (op.status === 'pending' || op.status === 'running')
        )

        if (hasActiveDestroy) {
          schedulerLogger.debug(
            'Skipping auto-destroy - destroy already in progress',
            {
              interviewId: interview.id,
              candidateName: interview.candidateName,
            }
          )
          continue
        }

        schedulerLogger.info('Auto-destroying interview (via DynamoDB)', {
          interviewId: interview.id,
          candidateName: interview.candidateName,
          autoDestroyAt: interview.autoDestroyAt?.toISOString(),
        })

        try {
          // Create a new destroy operation for the auto-destroy
          const destroyOpId = await operationManager.createOperation(
            'destroy',
            interview.id,
            interview.candidateName,
            interview.challenge,
            undefined, // scheduledAt
            undefined, // autoDestroyAt
            interview.saveFiles // Use saveFiles setting from interview record
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
            interviewId: interview.id,
            originalOperationId: undefined, // No original operation for DynamoDB-based auto-destroy
          })
        } catch (error) {
          schedulerLogger.error('Error auto-destroying interview (DynamoDB)', {
            interviewId: interview.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    } catch (error) {
      schedulerLogger.error('Error in processInterviewsAutoDestroy', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
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

    // Create OpenAI service account if configured
    let serviceAccountId: string | undefined
    let openaiApiKey: string | undefined

    if (config.services.openaiProjectId && config.services.openaiAdminKey) {
      await operationManager.addOperationLog(
        operation.id,
        '🤖 Creating OpenAI service account...'
      )

      const serviceAccountResult = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${operation.interviewId}`
      )

      if (serviceAccountResult.success) {
        serviceAccountId = serviceAccountResult.serviceAccountId
        openaiApiKey = serviceAccountResult.apiKey
        await operationManager.addOperationLog(
          operation.id,
          `✅ OpenAI service account created: ${serviceAccountId}`
        )
      } else {
        await operationManager.addOperationLog(
          operation.id,
          `❌ OpenAI service account creation failed: ${serviceAccountResult.error}`
        )
        await operationManager.setOperationResult(operation.id, {
          success: false,
          error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`,
        })

        this.emit({
          type: 'scheduled_create_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: false,
          error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`,
        })
        return // Exit early - don't proceed with interview creation
      }
    }

    const instance = {
      id: operation.interviewId,
      candidateName: operation.candidateName,
      challenge: operation.challenge,
      password: Math.random().toString(36).substring(2, 12),
      openaiApiKey,
    }

    try {
      // Get operation details to extract scheduling info
      const operationDetails = await operationManager.getOperation(operation.id)

      const result = await interviewManager.createInterviewWithInfrastructure(
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
        },
        (accessUrl: string) => {
          // Infrastructure ready callback - update operation
          operationManager
            .updateOperationInfrastructureReady(
              operation.id,
              accessUrl,
              instance.password
            )
            .catch(console.error)
        },
        operationDetails?.scheduledAt,
        operationDetails?.autoDestroyAt,
        operationDetails?.saveFiles,
        serviceAccountId
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
      // Fetch interview record to get OpenAI service account ID
      let interview = null
      try {
        interview = await interviewManager.getInterview(operation.interviewId)
      } catch (error) {
        schedulerLogger.debug(
          'Could not fetch interview record for OpenAI cleanup',
          {
            interviewId: operation.interviewId,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        )
      }

      // Delete OpenAI service account first (before destroying infrastructure)
      if (interview?.openaiServiceAccountId) {
        await operationManager.addOperationLog(
          operation.id,
          '🤖 Deleting OpenAI service account...'
        )

        const deleteResult = await openaiService.deleteServiceAccount(
          config.services.openaiProjectId,
          interview?.openaiServiceAccountId
        )

        if (deleteResult.success) {
          await operationManager.addOperationLog(
            operation.id,
            `✅ OpenAI service account deleted: ${interview?.openaiServiceAccountId}`
          )
        } else {
          await operationManager.addOperationLog(
            operation.id,
            `⚠️ OpenAI service account deletion failed: ${deleteResult.error}`
          )
          // Don't fail the entire destruction - continue with infrastructure cleanup
        }
      }

      // Now destroy the infrastructure
      const result = await interviewManager.destroyInterviewWithInfrastructure(
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
          '✅ Infrastructure destroyed successfully'
        )

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
