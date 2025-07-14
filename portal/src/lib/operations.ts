import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'

/**
 * Event emitted when an operation's state changes.
 * Used by SSE endpoint to notify connected clients in real-time.
 */
export interface OperationEvent {
  type: 'operation_update'
  operation: Operation
  timestamp: string
}

/**
 * Represents a background operation (interview creation or destruction).
 *
 * Operations track the complete lifecycle of long-running tasks including
 * scheduling, execution, completion, and detailed logging. They serve as
 * the source of truth for interview status and provide audit trails.
 */
export interface Operation {
  id: string
  type: 'create' | 'destroy'
  status:
    | 'pending' // Not yet started
    | 'running' // Currently executing
    | 'completed' // Finished successfully
    | 'failed' // Failed with error
    | 'cancelled' // Cancelled by user or system
    | 'scheduled' // Waiting for scheduled time
  interviewId: string
  candidateName?: string
  challenge?: string
  createdAt: Date // When the operation was scheduled/created
  executionStartedAt?: Date // When execution actually began
  completedAt?: Date
  scheduledAt?: Date
  autoDestroyAt?: Date
  logs: string[]
  result?: {
    success: boolean
    accessUrl?: string
    password?: string
    error?: string
    fullOutput?: string
    healthCheckPassed?: boolean
    infrastructureReady?: boolean
  }
}

/**
 * Central manager for background operations with persistent storage and event emission.
 *
 * This class handles all long-running interview operations including:
 * - Operation lifecycle management (create, track, complete)
 * - Persistent storage in /tmp for server restarts
 * - Real-time event emission for SSE clients
 * - Scheduled operation management
 * - Auto-destroy timeout handling
 *
 * All operation state changes trigger SSE events to keep the UI updated in real-time.
 *
 * @example
 * ```typescript
 * // Create a new operation
 * const opId = operationManager.createOperation('create', 'interview-123', 'John Doe', 'javascript')
 *
 * // Update operation status (triggers SSE event)
 * operationManager.updateOperationStatus(opId, 'running')
 *
 * // Add execution logs
 * operationManager.addOperationLog(opId, 'Starting Terraform...')
 *
 * // Complete the operation (triggers SSE event)
 * operationManager.setOperationResult(opId, { success: true, accessUrl: 'https://...' })
 * ```
 */
class OperationManager {
  private operations: Map<string, Operation> = new Map()
  private persistFile = `/tmp/${process.env.PROJECT_PREFIX || 'prequel'}-operations.json`
  private eventListeners: ((event: OperationEvent) => void)[] = []

  constructor() {
    this.loadFromDisk()
  }

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
  private emit(operation: Operation) {
    const event: OperationEvent = {
      type: 'operation_update',
      operation,
      timestamp: new Date().toISOString(),
    }

    this.eventListeners.forEach(listener => {
      try {
        listener(event)
      } catch (error) {
        console.error('Error in operation event listener:', error)
      }
    })
  }

  private async loadFromDisk() {
    try {
      const data = await fs.readFile(this.persistFile, 'utf-8')
      const operations = JSON.parse(data) as Array<
        Operation & { startedAt?: string | Date }
      >
      for (const op of operations) {
        // Convert date strings back to Date objects
        // Handle migration from old startedAt to new createdAt field
        if (op.startedAt && !op.createdAt) {
          op.createdAt = new Date(op.startedAt)
          delete op.startedAt
        } else {
          op.createdAt = new Date(op.createdAt)
        }
        if (op.executionStartedAt)
          op.executionStartedAt = new Date(op.executionStartedAt)
        if (op.completedAt) op.completedAt = new Date(op.completedAt)
        if (op.scheduledAt) op.scheduledAt = new Date(op.scheduledAt)
        if (op.autoDestroyAt) op.autoDestroyAt = new Date(op.autoDestroyAt)
        this.operations.set(op.id, op as Operation)
      }
      console.log(`Loaded ${operations.length} operations from disk`)
    } catch {
      console.log('No existing operations file found, starting fresh')
    }
  }

  private async saveToDisk() {
    try {
      const operations = Array.from(this.operations.values())
      await fs.writeFile(this.persistFile, JSON.stringify(operations, null, 2))
    } catch (error) {
      console.error('Failed to save operations to disk:', error)
    }
  }

  /**
   * Creates a new operation to track a background task.
   *
   * @param type - Type of operation ('create' or 'destroy')
   * @param interviewId - Interview ID this operation belongs to
   * @param candidateName - Optional candidate name for display
   * @param challenge - Optional challenge name for display
   * @param scheduledAt - Optional scheduled execution time
   * @param autoDestroyAt - Optional auto-destroy timeout
   * @returns The generated operation ID for tracking
   *
   * @example
   * ```typescript
   * // Create immediate operation
   * const opId = operationManager.createOperation('create', 'interview-123', 'John Doe', 'javascript')
   *
   * // Create scheduled operation
   * const scheduledOpId = operationManager.createOperation(
   *   'create', 'interview-456', 'Jane Smith', 'python',
   *   new Date('2025-01-15T10:00:00Z'),
   *   new Date('2025-01-15T11:00:00Z')
   * )
   * ```
   */
  createOperation(
    type: 'create' | 'destroy',
    interviewId: string,
    candidateName?: string,
    challenge?: string,
    scheduledAt?: Date,
    autoDestroyAt?: Date
  ): string {
    const operationId = uuidv4()

    const operation: Operation = {
      id: operationId,
      type,
      status: scheduledAt ? 'scheduled' : 'pending',
      interviewId,
      candidateName,
      challenge,
      createdAt: new Date(),
      scheduledAt,
      autoDestroyAt,
      logs: [],
    }

    this.operations.set(operationId, operation)
    this.saveToDisk()
    this.emit(operation)

    return operationId
  }

  getOperation(operationId: string): Operation | undefined {
    return this.operations.get(operationId)
  }

  getAllOperations(): Operation[] {
    return Array.from(this.operations.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
  }

  getOperationsByInterview(interviewId: string): Operation[] {
    return Array.from(this.operations.values())
      .filter(op => op.interviewId === interviewId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  updateOperationStatus(operationId: string, status: Operation['status']) {
    const operation = this.operations.get(operationId)
    if (operation) {
      operation.status = status
      // Mark execution start time when operation starts running
      if (status === 'running' && !operation.executionStartedAt) {
        operation.executionStartedAt = new Date()
      }
      if (status === 'completed' || status === 'failed') {
        operation.completedAt = new Date()
      }
      this.saveToDisk()
      this.emit(operation)
    }
  }

  getScheduledOperations(): Operation[] {
    return Array.from(this.operations.values())
      .filter(op => op.status === 'scheduled' && op.scheduledAt)
      .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
  }

  getOperationsForAutoDestroy(): Operation[] {
    const now = new Date()
    return Array.from(this.operations.values()).filter(
      op =>
        op.status === 'completed' &&
        op.autoDestroyAt &&
        op.autoDestroyAt <= now &&
        op.type === 'create' &&
        op.result?.success
    )
  }

  addOperationLog(operationId: string, logEntry: string) {
    const operation = this.operations.get(operationId)
    if (operation) {
      operation.logs.push(`[${new Date().toISOString()}] ${logEntry}`)
      this.saveToDisk()
    }
  }

  setOperationResult(operationId: string, result: Operation['result']) {
    const operation = this.operations.get(operationId)
    if (operation) {
      operation.result = result
      operation.status = result?.success ? 'completed' : 'failed'
      operation.completedAt = new Date()
      this.saveToDisk()
      this.emit(operation)
    }
  }

  /**
   * Updates an operation to mark infrastructure as ready while health check is still pending.
   *
   * This is called when Terraform has finished provisioning AWS resources and the ECS
   * service is starting up, but before the service passes health checks. This allows
   * the UI to show "configuring" status instead of "initializing".
   *
   * @param operationId - The operation ID to update
   * @param accessUrl - Optional access URL for the interview (if available)
   * @param password - Optional password for the interview (if available)
   */
  updateOperationInfrastructureReady(
    operationId: string,
    accessUrl?: string,
    password?: string
  ) {
    const operation = this.operations.get(operationId)
    if (operation) {
      if (!operation.result) {
        operation.result = {
          success: true,
          infrastructureReady: true,
          healthCheckPassed: false,
        }
      } else {
        operation.result.infrastructureReady = true
      }

      if (accessUrl) operation.result.accessUrl = accessUrl
      if (password) operation.result.password = password

      this.saveToDisk()
      this.emit(operation)
    }
  }

  cancelOperation(operationId: string): boolean {
    const operation = this.operations.get(operationId)
    if (
      operation &&
      (operation.status === 'pending' || operation.status === 'running')
    ) {
      operation.status = 'cancelled'
      operation.completedAt = new Date()
      operation.result = {
        success: false,
        error: 'Operation cancelled by user',
      }
      this.addOperationLog(operationId, 'Operation cancelled by user')
      this.saveToDisk()
      this.emit(operation)
      return true
    }
    return false
  }

  /**
   * Cancels all scheduled operations for a specific interview.
   *
   * This is called when an interview is manually destroyed before its scheduled
   * operations (like auto-destroy) can execute. It prevents orphaned operations
   * from running against non-existent resources.
   *
   * @param interviewId - The interview ID to cancel operations for
   * @returns Number of operations that were cancelled
   */
  cancelScheduledOperationsForInterview(interviewId: string): number {
    let cancelledCount = 0
    const operations = Array.from(this.operations.values())

    for (const operation of operations) {
      if (
        operation.interviewId === interviewId &&
        operation.status === 'scheduled'
      ) {
        operation.status = 'cancelled'
        operation.completedAt = new Date()
        operation.result = {
          success: false,
          error: 'Operation cancelled due to manual interview destruction',
        }
        this.addOperationLog(
          operation.id,
          'Operation cancelled due to manual interview destruction'
        )
        this.emit(operation)
        cancelledCount++
      }
    }

    if (cancelledCount > 0) {
      this.saveToDisk()
    }

    return cancelledCount
  }

  getOperationLogs(operationId: string): string[] {
    const operation = this.operations.get(operationId)
    return operation?.logs || []
  }

  // Clean up old operations (keep last 50)
  cleanup() {
    const operations = this.getAllOperations()
    if (operations.length > 50) {
      const toRemove = operations.slice(50)
      for (const op of toRemove) {
        this.operations.delete(op.id)
      }
      this.saveToDisk()
    }
  }
}

export const operationManager = new OperationManager()

// Clean up old operations every hour
setInterval(
  () => {
    operationManager.cleanup()
  },
  60 * 60 * 1000
)

// Initialize scheduler if in server environment
if (typeof window === 'undefined') {
  // Import and initialize scheduler on server-side only
  import('./scheduler')
    .then(() => {
      console.log('Scheduler initialized')
    })
    .catch(error => {
      console.error('Failed to initialize scheduler:', error)
    })
}
