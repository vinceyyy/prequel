import { operationManager } from './operations'
import { interviewManager } from './interviews'
import { assessmentManager } from './assessments'
import { schedulerLogger } from './logger'
import { executeScheduledCreate, executeScheduledDestroy } from './scheduledExecution'
import { processApiKeys } from './apiKeyLifecycle'
import { expireTakeHome, autoDestroyTakeHome } from './takeHomeLifecycle'

/**
 * Background scheduler service for processing scheduled operations and auto-destroy timeouts.
 *
 * This service runs continuously in the background (30-second polling interval) to:
 * 1. Process scheduled interview creation/destruction operations from DynamoDB
 * 2. Handle auto-destroy timeouts for active interviews
 * 3. Process take-home expiration and auto-destruction
 *
 * The scheduler ensures that interviews are created/destroyed at their scheduled times
 * and prevents resource waste by automatically cleaning up expired interviews.
 *
 * Key Features:
 * - **Scheduled Operations**: Executes operations at their scheduled time using DynamoDB queries
 * - **Auto-destroy**: Mandatory cleanup of interviews after timeout with duplicate prevention
 * - **Efficient Queries**: Combines related operations to minimize DynamoDB calls
 * - **Error Handling**: Robust error handling with detailed logging
 * - **DynamoDB Integration**: Uses efficient GSI queries for scalable operation lookup
 */
export class SchedulerService {
  private checkInterval: NodeJS.Timeout | null = null

  constructor() {
    this.start()
  }

  /**
   * Starts the scheduler service with 30-second polling interval.
   * Automatically called in constructor.
   */
  start() {
    // Don't run the polling loop under tests or when explicitly disabled
    // (e.g. running the API without the scheduler).
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_SCHEDULER === 'true') {
      return
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }

    // Check every 30 seconds for scheduled operations, auto-destroy, take-home expiration, and API keys
    this.checkInterval = setInterval(() => {
      this.processScheduledOperations()
      this.processAutoDestroyOperations()
      this.processTakeHomes() // Combined: handles both expiration and auto-destroy
      processApiKeys()
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
        schedulerLogger.debug(`Found ${scheduledOps.length} scheduled operations to check`)
      }

      for (const operation of scheduledOps) {
        if (operation.scheduledAt) {
          // Start provisioning 5 minutes before scheduled time to ensure instance is ready
          const provisioningTime = new Date(operation.scheduledAt.getTime() - 5 * 60 * 1000)

          if (provisioningTime <= now) {
            schedulerLogger.info('Processing scheduled operation', {
              operationId: operation.id,
              interviewId: operation.interviewId,
              type: operation.type,
              candidateName: operation.candidateName,
              scheduledAt: operation.scheduledAt.toISOString(),
              provisioningStartTime: provisioningTime.toISOString(),
              minutesBeforeScheduled: Math.round(
                (operation.scheduledAt.getTime() - now.getTime()) / 60000,
              ),
            })

            try {
              if (operation.type === 'create' && operation.candidateName && operation.challenge) {
                await executeScheduledCreate({
                  id: operation.id,
                  interviewId: operation.interviewId,
                  candidateName: operation.candidateName,
                  challenge: operation.challenge,
                })
              } else if (operation.type === 'destroy') {
                await executeScheduledDestroy({
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
                `❌ Scheduler error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              )
              await operationManager.updateOperationStatus(operation.id, 'failed')
            }
          }
        }
      }
    } catch (error) {
      // Handle DynamoDB throttling gracefully
      if (error instanceof Error && error.name === 'ThrottlingException') {
        schedulerLogger.warn(
          'DynamoDB throttling during scheduled operations check - will retry next cycle',
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
          'DynamoDB throttling during auto-destroy check - will retry next cycle',
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
      const autoDestroyOps = await operationManager.getOperationsForAutoDestroy()

      if (autoDestroyOps.length > 0) {
        schedulerLogger.debug(`Found ${autoDestroyOps.length} operations eligible for auto-destroy`)
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
            operation.saveFiles, // Inherit saveFiles setting from original operation
          )

          const destroyOp = await operationManager.getOperation(destroyOpId)
          if (destroyOp) {
            await executeScheduledDestroy({
              id: destroyOp.id,
              interviewId: destroyOp.interviewId,
              candidateName: destroyOp.candidateName,
              challenge: destroyOp.challenge,
              saveFiles: destroyOp.saveFiles,
            })
          }
        } catch (error) {
          schedulerLogger.error('Error auto-destroying interview (operations)', {
            interviewId: operation.interviewId,
            operationId: operation.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
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
        (interview) =>
          interview.autoDestroyAt &&
          interview.autoDestroyAt <= now &&
          interview.status === 'active', // Only destroy active interviews
      )

      if (expiredInterviews.length > 0) {
        schedulerLogger.debug(
          `Found ${expiredInterviews.length} interviews eligible for auto-destroy from DynamoDB`,
        )
      }

      for (const interview of expiredInterviews) {
        // Check if there's already a destroy operation in progress for this interview
        const operations = await operationManager.getOperationsByInterview(interview.id)
        const hasActiveDestroy = operations.some(
          (op) => op.type === 'destroy' && (op.status === 'pending' || op.status === 'running'),
        )

        if (hasActiveDestroy) {
          schedulerLogger.debug('Skipping auto-destroy - destroy already in progress', {
            interviewId: interview.id,
            candidateName: interview.candidateName,
          })
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
            interview.saveFiles, // Use saveFiles setting from interview record
          )

          const destroyOp = await operationManager.getOperation(destroyOpId)
          if (destroyOp) {
            await executeScheduledDestroy({
              id: destroyOp.id,
              interviewId: destroyOp.interviewId,
              candidateName: destroyOp.candidateName,
              challenge: destroyOp.challenge,
              saveFiles: destroyOp.saveFiles,
            })
          }
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

  /**
   * Combined processing of take-homes: expiration and auto-destroy.
   * Uses a single DynamoDB query for efficiency.
   * Called every 30 seconds as part of the scheduler tick.
   */
  private async processTakeHomes() {
    try {
      // Single DynamoDB query for all take-homes
      const takeHomes = await assessmentManager.listTakeHomes()

      // Early exit if no take-homes
      if (takeHomes.length === 0) {
        return
      }

      const now = Math.floor(Date.now() / 1000)

      for (const takeHome of takeHomes) {
        // CASE 1: Expire available take-homes that are past their availability window
        if (takeHome.sessionStatus === 'available' && takeHome.availableUntil <= now) {
          await expireTakeHome(takeHome)
          continue
        }

        // CASE 2: Auto-destroy activated take-homes that have reached timeout
        if (
          takeHome.sessionStatus === 'activated' &&
          takeHome.instanceStatus === 'active' &&
          takeHome.autoDestroyAt &&
          takeHome.autoDestroyAt <= now
        ) {
          await autoDestroyTakeHome(takeHome)
        }
      }
    } catch (error) {
      schedulerLogger.error('Error in processTakeHomes', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

// Global scheduler instance
export const scheduler = new SchedulerService()
