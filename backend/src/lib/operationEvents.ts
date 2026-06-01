import { operationsLogger } from './logger'
import type { Operation, OperationEvent } from './types/operation'

/**
 * In-process event bus for operation state changes.
 *
 * Manages the set of registered listeners and fans out operation update and
 * log update events. Extracted from OperationManager so the event mechanism
 * is isolated from DynamoDB persistence concerns.
 */
export class OperationEventBus {
  private eventListeners: ((event: OperationEvent) => void)[] = []

  /**
   * Adds an event listener for operation state changes.
   * @param listener - Function to call when operations change state
   */
  addEventListener(listener: (event: OperationEvent) => void) {
    this.eventListeners.push(listener)
  }

  /**
   * Removes an event listener.
   * @param listener - The listener function to remove
   */
  removeEventListener(listener: (event: OperationEvent) => void) {
    const index = this.eventListeners.indexOf(listener)
    if (index > -1) {
      this.eventListeners.splice(index, 1)
    }
  }

  /**
   * Emits an operation update event to all registered listeners.
   * Called automatically whenever operation state changes.
   * @param operation - The operation that changed state
   */
  emit(operation: Operation) {
    const event: OperationEvent = {
      type: 'operation_update',
      operation,
      timestamp: new Date().toISOString(),
    }

    this.eventListeners.forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        operationsLogger.error('Error in operation event listener', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })
  }

  /**
   * Emits a log update event to all registered listeners.
   * Enables real-time log streaming via Server-Sent Events.
   */
  emitLogUpdate(operationId: string, logs: string[]): void {
    const event: OperationEvent = {
      type: 'operation_logs',
      operationId,
      logs,
      timestamp: new Date().toISOString(),
    }

    this.eventListeners.forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        operationsLogger.error('Error in operation log event listener', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })
  }
}
