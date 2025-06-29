import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'

export interface Operation {
  id: string
  type: 'create' | 'destroy'
  status: 'pending' | 'running' | 'completed' | 'failed'
  interviewId: string
  candidateName?: string
  scenario?: string
  startedAt: Date
  completedAt?: Date
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

  constructor() {
    this.loadFromDisk()
  }

  private async loadFromDisk() {
    try {
      const data = await fs.readFile(this.persistFile, 'utf-8')
      const operations = JSON.parse(data) as Operation[]
      for (const op of operations) {
        // Convert date strings back to Date objects
        op.startedAt = new Date(op.startedAt)
        if (op.completedAt) op.completedAt = new Date(op.completedAt)
        this.operations.set(op.id, op)
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
    scenario?: string
  ): string {
    const operationId = uuidv4()

    const operation: Operation = {
      id: operationId,
      type,
      status: 'pending',
      interviewId,
      candidateName,
      scenario,
      startedAt: new Date(),
      logs: [],
    }

    this.operations.set(operationId, operation)
    this.saveToDisk()

    return operationId
  }

  getOperation(operationId: string): Operation | undefined {
    return this.operations.get(operationId)
  }

  getAllOperations(): Operation[] {
    return Array.from(this.operations.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    )
  }

  getOperationsByInterview(interviewId: string): Operation[] {
    return Array.from(this.operations.values())
      .filter(op => op.interviewId === interviewId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  }

  updateOperationStatus(operationId: string, status: Operation['status']) {
    const operation = this.operations.get(operationId)
    if (operation) {
      operation.status = status
      if (status === 'completed' || status === 'failed') {
        operation.completedAt = new Date()
      }
      this.saveToDisk()
    }
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
    }
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
