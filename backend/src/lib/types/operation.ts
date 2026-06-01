/**
 * Operation types for background task tracking.
 */

/**
 * Event emitted when an operation's state changes.
 * Used by SSE endpoint to notify connected clients in real-time.
 *
 * Client-side filtering by session type:
 * Operations can be filtered by checking the `operation.interviewId` prefix:
 * - `operation.interviewId.startsWith('INTERVIEW#')` - Interview session operations
 * - `operation.interviewId.startsWith('TAKEHOME#')` - Take-home session operations
 *
 * This allows clients (interviews page vs take-homes page) to only respond to
 * events relevant to their specific session type.
 */
export interface OperationEvent {
  type: 'operation_update' | 'operation_logs'
  operation?: Operation
  operationId?: string
  logs?: string[]
  timestamp: string
}

/**
 * Represents a background operation (instance creation or destruction).
 *
 * Operations track the complete lifecycle of long-running tasks including
 * scheduling, execution, completion, and detailed logging. They serve as
 * the source of truth for instance status and provide audit trails.
 *
 * NOTE: Despite the field name 'interviewId', this actually stores the
 * instanceId which can reference either an Interview or TakeHome record.
 * The field will be renamed to 'instanceId' in a future update to match
 * the new architecture.
 */
export interface Operation {
  id: string
  type: 'create' | 'destroy' | 'revoke_takehome'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'scheduled'
  interviewId: string // TODO: Rename to instanceId (references Interview or TakeHome)
  candidateName?: string
  challenge?: string
  saveFiles?: boolean
  createdAt: Date
  executionStartedAt?: Date
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
    historyS3Key?: string
  }
}
