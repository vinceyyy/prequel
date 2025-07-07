import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'

export interface OperationEvent {
  type: 'operation_update'
  operation: Operation
  timestamp: string
}

export interface Operation {
  id: string
  type: 'create' | 'destroy'
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'scheduled'
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
  }
}

class OperationManager {
  private operations: Map<string, Operation> = new Map()
  private persistFile = '/tmp/prequel-operations.json'
  private eventListeners: ((event: OperationEvent) => void)[] = []

  constructor() {
    this.loadFromDisk()
  }

  addEventListener(listener: (event: OperationEvent) => void) {
    this.eventListeners.push(listener)
  }

  removeEventListener(listener: (event: OperationEvent) => void) {
    const index = this.eventListeners.indexOf(listener)
    if (index > -1) {
      this.eventListeners.splice(index, 1)
    }
  }

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
