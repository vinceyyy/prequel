import { operationManager } from './operations'
import { terraformManager } from './terraform'

export class SchedulerService {
  private checkInterval: NodeJS.Timeout | null = null
  private eventListeners: ((event: SchedulerEvent) => void)[] = []

  constructor() {
    this.start()
  }

  start() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }

    // Check every 30 seconds for scheduled operations
    this.checkInterval = setInterval(() => {
      this.processScheduledOperations()
      this.processAutoDestroyOperations()
    }, 30000)

    console.log('Scheduler service started')
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    console.log('Scheduler service stopped')
  }

  addEventListener(listener: (event: SchedulerEvent) => void) {
    this.eventListeners.push(listener)
  }

  removeEventListener(listener: (event: SchedulerEvent) => void) {
    const index = this.eventListeners.indexOf(listener)
    if (index > -1) {
      this.eventListeners.splice(index, 1)
    }
  }

  private emit(event: SchedulerEvent) {
    this.eventListeners.forEach(listener => {
      try {
        listener(event)
      } catch (error) {
        console.error('Error in scheduler event listener:', error)
      }
    })
  }

  private async processScheduledOperations() {
    const scheduledOps = operationManager.getScheduledOperations()
    const now = new Date()

    for (const operation of scheduledOps) {
      if (operation.scheduledAt && operation.scheduledAt <= now) {
        console.log(
          `Processing scheduled operation ${operation.id} for interview ${operation.interviewId}`
        )

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
            })
          }
        } catch (error) {
          console.error(
            `Error processing scheduled operation ${operation.id}:`,
            error
          )
          operationManager.addOperationLog(
            operation.id,
            `❌ Scheduler error: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
          operationManager.updateOperationStatus(operation.id, 'failed')
        }
      }
    }
  }

  private async processAutoDestroyOperations() {
    const autoDestroyOps = operationManager.getOperationsForAutoDestroy()

    for (const operation of autoDestroyOps) {
      console.log(
        `Auto-destroying interview ${operation.interviewId} (operation ${operation.id})`
      )

      try {
        // Create a new destroy operation for the auto-destroy
        const destroyOpId = operationManager.createOperation(
          'destroy',
          operation.interviewId,
          operation.candidateName,
          operation.challenge
        )

        const destroyOp = operationManager.getOperation(destroyOpId)
        if (destroyOp) {
          await this.executeScheduledDestroy({
            id: destroyOp.id,
            interviewId: destroyOp.interviewId,
            candidateName: destroyOp.candidateName,
          })
        }

        this.emit({
          type: 'auto_destroy_triggered',
          operationId: destroyOpId,
          interviewId: operation.interviewId,
          originalOperationId: operation.id,
        })
      } catch (error) {
        console.error(
          `Error auto-destroying interview ${operation.interviewId}:`,
          error
        )
      }
    }
  }

  private async executeScheduledCreate(operation: {
    id: string
    interviewId: string
    candidateName: string
    challenge: string
  }) {
    operationManager.updateOperationStatus(operation.id, 'running')
    operationManager.addOperationLog(
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
            operationManager.addOperationLog(operation.id, line)
          })
        }
      )

      if (result.success) {
        operationManager.addOperationLog(
          operation.id,
          '✅ Scheduled interview created successfully!'
        )
        operationManager.addOperationLog(
          operation.id,
          `Access URL: ${result.accessUrl}`
        )

        operationManager.setOperationResult(operation.id, {
          success: true,
          accessUrl: result.accessUrl,
          password: instance.password,
          fullOutput: result.fullOutput,
        })

        this.emit({
          type: 'scheduled_create_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: true,
          accessUrl: result.accessUrl,
        })
      } else {
        operationManager.addOperationLog(
          operation.id,
          '❌ Scheduled interview creation failed'
        )
        operationManager.addOperationLog(operation.id, `Error: ${result.error}`)

        operationManager.setOperationResult(operation.id, {
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
      operationManager.addOperationLog(operation.id, `❌ Error: ${errorMsg}`)
      operationManager.setOperationResult(operation.id, {
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
  }) {
    operationManager.updateOperationStatus(operation.id, 'running')
    operationManager.addOperationLog(
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
            operationManager.addOperationLog(operation.id, line)
          })
        }
      )

      if (result.success) {
        operationManager.addOperationLog(
          operation.id,
          '✅ Scheduled interview destroyed successfully!'
        )
        operationManager.setOperationResult(operation.id, {
          success: true,
          fullOutput: result.fullOutput,
        })

        this.emit({
          type: 'scheduled_destroy_completed',
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: true,
        })
      } else {
        operationManager.addOperationLog(
          operation.id,
          '❌ Scheduled interview destruction failed'
        )
        operationManager.addOperationLog(operation.id, `Error: ${result.error}`)

        operationManager.setOperationResult(operation.id, {
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
      operationManager.addOperationLog(operation.id, `❌ Error: ${errorMsg}`)
      operationManager.setOperationResult(operation.id, {
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
