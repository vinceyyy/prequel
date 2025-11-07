import { v4 as uuidv4 } from 'uuid'
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { operationsLogger } from './logger'
import { config } from './config'
import { interviewManager } from './interviews'
import type { Interview } from './interviews'

/**
 * Event emitted when an operation's state changes.
 * Used by SSE endpoint to notify connected clients in real-time.
 */
export interface OperationEvent {
  type: 'operation_update' | 'operation_logs'
  operation?: Operation
  operationId?: string
  logs?: string[]
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
  saveFiles?: boolean // Whether to save candidate files to S3 before destruction
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
    historyS3Key?: string // S3 key where candidate files were saved
  }
}

/**
 * DynamoDB-backed operation manager with persistent storage and event emission.
 *
 * This class leverages DynamoDB features for efficient operation management:
 * - **Persistent Storage**: Operations survive container restarts
 * - **Efficient Queries**: Uses GSI for fast lookups by status, interview, type
 * - **Auto-cleanup**: TTL automatically removes old operations after 24 hours
 * - **Atomic Updates**: DynamoDB handles concurrent operation updates
 * - **Event Emission**: Real-time SSE events for UI updates
 *
 * DynamoDB Table Schema:
 * - **Primary Key**: id (string) - Unique operation identifier
 * - **GSI 1**: status-scheduledAt-index - Query operations by status and scheduledAt
 * - **GSI 2**: status-autoDestroyAt-index - Query operations by status and autoDestroyAt
 * - **GSI 3**: interviewId-type-index - Query operations by interviewId and type
 * - **TTL**: Automatic cleanup after 24 hours using ttl attribute
 *
 * Key DynamoDB optimizations:
 * - Query operations by status for scheduled/auto-destroy lookups
 * - Query operations by interviewId to prevent duplicate destroys
 * - Batch operations for efficient bulk updates
 * - TTL for automatic cleanup without manual maintenance
 *
 * @example
 * ```typescript
 * // Create a new operation
 * const opId = await operationManager.createOperation('create', 'interview-123', 'John Doe', 'javascript')
 *
 * // Update operation status (triggers SSE event)
 * await operationManager.updateOperationStatus(opId, 'running')
 *
 * // Add execution logs
 * await operationManager.addOperationLog(opId, 'Starting Terraform...')
 *
 * // Complete the operation (triggers SSE event)
 * await operationManager.setOperationResult(opId, { success: true, accessUrl: 'https://...' })
 * ```
 */
class OperationManager {
  private dynamoClient: DynamoDBClient
  private tableName: string
  private eventListeners: ((event: OperationEvent) => void)[] = []

  /**
   * Creates a new OperationManager instance with DynamoDB client.
   *
   * Uses centralized configuration system for AWS credentials and table names.
   * Table name is auto-generated as: {PROJECT_PREFIX}-{ENVIRONMENT}-operations
   */
  constructor() {
    this.dynamoClient = new DynamoDBClient(config.aws.getCredentials())
    this.tableName = config.database.operationsTable

    // Debug logging for server environment
    if (typeof window === 'undefined') {
      operationsLogger.debug('OperationManager initialized', {
        tableName: this.tableName,
        region: process.env.AWS_REGION || 'us-east-1',
      })
    }
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
  private emitLogUpdate(operationId: string, logs: string[]): void {
    const event: OperationEvent = {
      type: 'operation_logs',
      operationId,
      logs,
      timestamp: new Date().toISOString(),
    }

    this.eventListeners.forEach(listener => {
      try {
        listener(event)
      } catch (error) {
        operationsLogger.error('Error in operation log event listener', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })
  }

  /**
   * Map operation status to interview status
   */
  private operationStatusToInterviewStatus(
    operationStatus: Operation['status']
  ): Interview['status'] {
    const statusMap: Record<Operation['status'], Interview['status']> = {
      pending: 'scheduled',
      running: 'initializing',
      completed: 'active',
      failed: 'error',
      cancelled: 'error',
      scheduled: 'scheduled',
    }
    return statusMap[operationStatus]
  }

  /**
   * Sync operation status to linked interview record
   * This keeps the interview table updated for real-time UI display
   */
  private async syncInterviewStatus(operation: Operation): Promise<void> {
    if (!operation.interviewId) {
      return // No interview to sync
    }

    try {
      const interviewStatus = this.operationStatusToInterviewStatus(
        operation.status
      )

      await interviewManager.updateInterviewStatus(
        operation.interviewId,
        interviewStatus,
        {
          accessUrl: operation.result?.accessUrl,
          password: operation.result?.password,
        }
      )
    } catch (error) {
      operationsLogger.error('Error syncing interview status', {
        operationId: operation.id,
        interviewId: operation.interviewId,
        error,
      })
      // Don't throw - sync failure shouldn't break operation updates
    }
  }

  /**
   * Converts a Date to Unix timestamp (seconds) for DynamoDB storage.
   * DynamoDB doesn't have native Date support, so we store as numbers.
   */
  private dateToTimestamp(date?: Date): number | undefined {
    return date ? Math.floor(date.getTime() / 1000) : undefined
  }

  /**
   * Converts Unix timestamp back to Date object.
   */
  private timestampToDate(timestamp?: number): Date | undefined {
    return timestamp ? new Date(timestamp * 1000) : undefined
  }

  /**
   * Converts Operation to DynamoDB item format.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private operationToDynamoItem(operation: Operation): Record<string, any> {
    const now = Date.now()
    const ttl = Math.floor(now / 1000) + 24 * 60 * 60 // 24 hours from now

    return {
      id: operation.id,
      type: operation.type,
      status: operation.status,
      interviewId: operation.interviewId,
      candidateName: operation.candidateName,
      challenge: operation.challenge,
      saveFiles: operation.saveFiles,
      createdAt: this.dateToTimestamp(operation.createdAt),
      executionStartedAt: this.dateToTimestamp(operation.executionStartedAt),
      completedAt: this.dateToTimestamp(operation.completedAt),
      scheduledAt: this.dateToTimestamp(operation.scheduledAt),
      autoDestroyAt: this.dateToTimestamp(operation.autoDestroyAt),
      logs: operation.logs,
      result: operation.result,
      ttl, // TTL for automatic cleanup
    }
  }

  /**
   * Converts DynamoDB item to Operation format.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dynamoItemToOperation(item: Record<string, any>): Operation {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      interviewId: item.interviewId,
      candidateName: item.candidateName,
      challenge: item.challenge,
      saveFiles: item.saveFiles,
      createdAt: this.timestampToDate(item.createdAt) || new Date(),
      executionStartedAt: this.timestampToDate(item.executionStartedAt),
      completedAt: this.timestampToDate(item.completedAt),
      scheduledAt: this.timestampToDate(item.scheduledAt),
      autoDestroyAt: this.timestampToDate(item.autoDestroyAt),
      logs: item.logs || [],
      result: item.result,
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
   * const opId = await operationManager.createOperation('create', 'interview-123', 'John Doe', 'javascript')
   *
   * // Create scheduled operation
   * const scheduledOpId = await operationManager.createOperation(
   *   'create', 'interview-456', 'Jane Smith', 'python',
   *   new Date('2025-01-15T10:00:00Z'),
   *   new Date('2025-01-15T11:00:00Z')
   * )
   * ```
   */
  async createOperation(
    type: 'create' | 'destroy',
    interviewId: string,
    candidateName?: string,
    challenge?: string,
    scheduledAt?: Date,
    autoDestroyAt?: Date,
    saveFiles?: boolean
  ): Promise<string> {
    const operationId = uuidv4()

    const operation: Operation = {
      id: operationId,
      type,
      status: scheduledAt ? 'scheduled' : 'pending',
      interviewId,
      candidateName,
      challenge,
      saveFiles,
      createdAt: new Date(),
      scheduledAt,
      autoDestroyAt,
      logs: [],
    }

    const item = this.operationToDynamoItem(operation)

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      )

      this.emit(operation)
      return operationId
    } catch (error) {
      operationsLogger.error('Error creating operation in DynamoDB', {
        tableName: this.tableName,
        operationId: operationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    }
  }

  /**
   * Retrieves a single operation by ID.
   */
  async getOperation(operationId: string): Promise<Operation | undefined> {
    const response = await this.dynamoClient.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
      })
    )

    if (!response.Item) {
      return undefined
    }

    const item = unmarshall(response.Item)
    return this.dynamoItemToOperation(item)
  }

  /**
   * Retrieves all operations, sorted by creation time (newest first).
   * Uses Scan operation - should be used sparingly for large datasets.
   */
  async getAllOperations(): Promise<Operation[]> {
    const response = await this.dynamoClient.send(
      new ScanCommand({
        TableName: this.tableName,
      })
    )

    const operations = (response.Items || [])
      .map(item => this.dynamoItemToOperation(unmarshall(item)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return operations
  }

  /**
   * Retrieves active operations (running + scheduled) using efficient GSI queries.
   * Much more efficient than getAllOperations() when you only need active operations.
   * Perfect for SSE status updates and real-time monitoring.
   *
   * @returns Promise<Operation[]> - Array of active operations (running + scheduled)
   */
  async getActiveOperations(): Promise<Operation[]> {
    const [runningOps, scheduledOps] = await Promise.all([
      this.getOperationsByStatus('running'),
      this.getOperationsByStatus('scheduled'),
    ])

    // Combine and sort by creation time (newest first)
    const activeOperations = [...runningOps, ...scheduledOps].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )

    return activeOperations
  }

  /**
   * Retrieves operations by status using GSI query (much more efficient than scan).
   * Uses the 'status-scheduledAt-index' GSI for efficient querying.
   *
   * @param status - The operation status to query for
   * @returns Promise<Operation[]> - Array of operations with the specified status
   */
  private async getOperationsByStatus(
    status: Operation['status']
  ): Promise<Operation[]> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'status-scheduledAt-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': status,
        }),
      })
    )

    const operations = (response.Items || [])
      .map(item => this.dynamoItemToOperation(unmarshall(item)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return operations
  }

  /**
   * Retrieves all operations for a specific interview using GSI.
   * Much more efficient than scanning all operations.
   */
  async getOperationsByInterview(interviewId: string): Promise<Operation[]> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'interviewId-type-index',
        KeyConditionExpression: 'interviewId = :interviewId',
        ExpressionAttributeValues: marshall({
          ':interviewId': interviewId,
        }),
      })
    )

    const operations = (response.Items || [])
      .map(item => this.dynamoItemToOperation(unmarshall(item)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return operations
  }

  /**
   * Updates operation status and automatically sets execution/completion timestamps.
   */
  async updateOperationStatus(
    operationId: string,
    status: Operation['status']
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    let updateExpression = 'SET #status = :status'
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expressionAttributeValues: Record<string, any> = {
      ':status': status,
    }

    // Mark execution start time when operation starts running
    if (status === 'running') {
      updateExpression += ', executionStartedAt = :executionStartedAt'
      expressionAttributeValues[':executionStartedAt'] = now
    }

    // Mark completion time when operation finishes
    if (status === 'completed' || status === 'failed') {
      updateExpression += ', completedAt = :completedAt'
      expressionAttributeValues[':completedAt'] = now
    }

    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: marshall(expressionAttributeValues, {
          removeUndefinedValues: true,
        }),
      })
    )

    // Fetch updated operation and emit event
    const operation = await this.getOperation(operationId)
    if (operation) {
      // Sync status to interview
      await this.syncInterviewStatus(operation)

      this.emit(operation)
    }
  }

  /**
   * Retrieves scheduled operations that need to be executed using GSI.
   *
   * Uses the 'status-scheduledAt-index' GSI for efficient querying of operations
   * with 'scheduled' status. Much more efficient than scanning all operations.
   *
   * @returns Promise<Operation[]> - Array of scheduled operations sorted by scheduledAt
   */
  async getScheduledOperations(): Promise<Operation[]> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'status-scheduledAt-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': 'scheduled',
        }),
      })
    )

    const operations = (response.Items || [])
      .map(item => this.dynamoItemToOperation(unmarshall(item)))
      .sort(
        (a, b) =>
          (a.scheduledAt?.getTime() || 0) - (b.scheduledAt?.getTime() || 0)
      )

    return operations
  }

  /**
   * Retrieves operations eligible for auto-destroy using GSI and additional filtering.
   *
   * Strategy:
   * 1. Query all completed operations using 'status-autoDestroyAt-index' GSI
   * 2. Filter for create operations with auto-destroy times that have elapsed
   * 3. Check if destroy operation already exists for each interview using 'interviewId-type-index' GSI
   *
   * This approach uses efficient DynamoDB GSI queries instead of scanning all operations,
   * making it highly scalable and preventing duplicate destroy operations.
   *
   * @returns Promise<Operation[]> - Array of operations eligible for auto-destroy
   */
  async getOperationsForAutoDestroy(): Promise<Operation[]> {
    const now = Math.floor(Date.now() / 1000)

    // Query all completed operations
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'status-autoDestroyAt-index',
        KeyConditionExpression: '#status = :status AND autoDestroyAt <= :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': 'completed',
          ':now': now,
        }),
      })
    )

    const completedOps = (response.Items || [])
      .map(item => this.dynamoItemToOperation(unmarshall(item)))
      .filter(
        op =>
          op.type === 'create' &&
          op.result?.success &&
          op.autoDestroyAt &&
          op.autoDestroyAt <= new Date()
      )

    // Filter out operations that already have destroy operations
    const eligibleOps: Operation[] = []

    for (const op of completedOps) {
      const hasDestroy = await this.hasDestroyOperationForInterview(
        op.interviewId
      )
      if (!hasDestroy) {
        eligibleOps.push(op)
      }
    }

    return eligibleOps
  }

  /**
   * Checks if there's already a destroy operation for a given interview using GSI.
   * Much more efficient than scanning all operations.
   */
  async hasDestroyOperationForInterview(interviewId: string): Promise<boolean> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'interviewId-type-index',
        KeyConditionExpression: 'interviewId = :interviewId AND #type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: marshall({
          ':interviewId': interviewId,
          ':type': 'destroy',
        }),
        Limit: 1, // We only need to know if one exists
      })
    )

    return (response.Items?.length || 0) > 0
  }

  /**
   * Adds a log entry to an operation with batching to reduce DynamoDB writes.
   */
  private logBatch: Map<string, string[]> = new Map()
  private logBatchTimeout: NodeJS.Timeout | null = null

  async addOperationLog(operationId: string, logEntry: string): Promise<void> {
    const timestamp = new Date().toISOString()
    const logWithTimestamp = `[${timestamp}] ${logEntry}`

    // Add to batch
    if (!this.logBatch.has(operationId)) {
      this.logBatch.set(operationId, [])
    }
    this.logBatch.get(operationId)!.push(logWithTimestamp)

    // Schedule batch flush if not already scheduled
    if (!this.logBatchTimeout) {
      this.logBatchTimeout = setTimeout(() => {
        this.flushLogBatch()
      }, 2000) // Batch logs for 2 seconds
    }
  }

  private async flushLogBatch(): Promise<void> {
    if (this.logBatch.size === 0) return

    const batchOperations = Array.from(this.logBatch.entries())
    this.logBatch.clear()
    this.logBatchTimeout = null

    // Process each operation's logs
    for (const [operationId, logs] of batchOperations) {
      try {
        await this.dynamoClient.send(
          new UpdateItemCommand({
            TableName: this.tableName,
            Key: marshall({ id: operationId }),
            UpdateExpression:
              'SET logs = list_append(if_not_exists(logs, :empty_list), :logs)',
            ExpressionAttributeValues: marshall({
              ':logs': logs,
              ':empty_list': [],
            }),
          })
        )

        // Emit SSE event for log updates - enables real-time log streaming
        this.emitLogUpdate(operationId, logs)
      } catch (error) {
        operationsLogger.error('Error flushing logs for operation', {
          operationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  /**
   * Sets the final result of an operation and updates status accordingly.
   */
  async setOperationResult(
    operationId: string,
    result: Operation['result']
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const status = result?.success ? 'completed' : 'failed'

    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression:
          'SET #result = :result, #status = :status, completedAt = :completedAt',
        ExpressionAttributeNames: {
          '#result': 'result',
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall(
          {
            ':result': result,
            ':status': status,
            ':completedAt': now,
          },
          { removeUndefinedValues: true }
        ),
      })
    )

    // Fetch updated operation and emit event
    const operation = await this.getOperation(operationId)
    if (operation) {
      // Sync status to interview
      await this.syncInterviewStatus(operation)

      this.emit(operation)
    }
  }

  /**
   * Updates an operation to mark infrastructure as ready while health check is still pending.
   */
  async updateOperationInfrastructureReady(
    operationId: string,
    accessUrl?: string,
    password?: string
  ): Promise<void> {
    const operation = await this.getOperation(operationId)
    if (!operation) return

    const updatedResult = {
      ...operation.result,
      success: true,
      infrastructureReady: true,
      healthCheckPassed: false,
      ...(accessUrl && { accessUrl }),
      ...(password && { password }),
    }

    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: 'SET #result = :result',
        ExpressionAttributeNames: {
          '#result': 'result',
        },
        ExpressionAttributeValues: marshall(
          {
            ':result': updatedResult,
          },
          { removeUndefinedValues: true }
        ),
      })
    )

    // Set interview to "configuring" when infrastructure is ready
    if (operation.interviewId) {
      try {
        await interviewManager.updateInterviewStatus(
          operation.interviewId,
          'configuring',
          { accessUrl, password }
        )
      } catch (error) {
        operationsLogger.error('Error setting interview to configuring', {
          operationId: operation.id,
          interviewId: operation.interviewId,
          error,
        })
      }
    }

    // Fetch updated operation and emit event
    const updatedOperation = await this.getOperation(operationId)
    if (updatedOperation) {
      this.emit(updatedOperation)
    }
  }

  /**
   * Updates credentials (URL and password) for a scheduled interview without changing operation status.
   * Used to store credentials immediately when an interview is scheduled.
   */
  async updateScheduledInterviewCredentials(
    operationId: string,
    accessUrl: string,
    password: string
  ): Promise<void> {
    const operation = await this.getOperation(operationId)
    if (!operation) return

    const updatedResult = {
      ...operation.result,
      accessUrl,
      password,
    }

    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: 'SET #result = :result',
        ExpressionAttributeNames: {
          '#result': 'result',
        },
        ExpressionAttributeValues: marshall(
          {
            ':result': updatedResult,
          },
          { removeUndefinedValues: true }
        ),
      })
    )

    // Fetch updated operation and emit event
    const updatedOperation = await this.getOperation(operationId)
    if (updatedOperation) {
      this.emit(updatedOperation)
    }
  }

  /**
   * Cancels an operation that is pending, running, or scheduled.
   */
  async cancelOperation(operationId: string): Promise<boolean> {
    const operation = await this.getOperation(operationId)
    if (
      !operation ||
      !['pending', 'running', 'scheduled'].includes(operation.status)
    ) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)

    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression:
          'SET #status = :status, completedAt = :completedAt, #result = :result',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result',
        },
        ExpressionAttributeValues: marshall(
          {
            ':status': 'cancelled',
            ':completedAt': now,
            ':result': {
              success: false,
              error: 'Operation cancelled by user',
            },
          },
          { removeUndefinedValues: true }
        ),
      })
    )

    await this.addOperationLog(operationId, 'Operation cancelled by user')

    // Fetch updated operation and emit event
    const updatedOperation = await this.getOperation(operationId)
    if (updatedOperation) {
      this.emit(updatedOperation)
    }

    return true
  }

  /**
   * Cancels all scheduled operations for a specific interview.
   * Used when an interview is manually destroyed before scheduled operations execute.
   */
  async cancelScheduledOperationsForInterview(
    interviewId: string
  ): Promise<number> {
    // Query all operations for this interview
    const operations = await this.getOperationsByInterview(interviewId)
    const scheduledOps = operations.filter(op => op.status === 'scheduled')

    if (scheduledOps.length === 0) {
      return 0
    }

    const now = Math.floor(Date.now() / 1000)

    // Cancel each scheduled operation
    for (const op of scheduledOps) {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id: op.id }),
          UpdateExpression:
            'SET #status = :status, completedAt = :completedAt, #result = :result',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#result': 'result',
          },
          ExpressionAttributeValues: marshall(
            {
              ':status': 'cancelled',
              ':completedAt': now,
              ':result': {
                success: false,
                error:
                  'Operation cancelled due to manual interview destruction',
              },
            },
            { removeUndefinedValues: true }
          ),
        })
      )

      await this.addOperationLog(
        op.id,
        'Operation cancelled due to manual interview destruction'
      )

      // Fetch updated operation and emit event
      const updatedOperation = await this.getOperation(op.id)
      if (updatedOperation) {
        this.emit(updatedOperation)
      }
    }

    return scheduledOps.length
  }

  /**
   * Gets logs for a specific operation.
   */
  async getOperationLogs(operationId: string): Promise<string[]> {
    const operation = await this.getOperation(operationId)
    return operation?.logs || []
  }

  /**
   * Cleans up old operations (not needed with DynamoDB TTL, but kept for compatibility).
   *
   * DynamoDB TTL automatically removes operations after 24 hours using the 'ttl' attribute.
   * This is more efficient than manual cleanup and requires no maintenance.
   *
   * TTL Configuration:
   * - Set on each operation during creation (24 hours from now)
   * - DynamoDB handles deletion automatically
   * - No manual intervention required
   */
  async cleanup(): Promise<void> {
    // With DynamoDB TTL, this is handled automatically
    // This method is kept for compatibility but does nothing
    operationsLogger.info(
      'Cleanup not needed - DynamoDB TTL handles automatic cleanup'
    )
  }
}

export const operationManager = new OperationManager()

// Note: Cleanup interval not needed with DynamoDB TTL
// TTL will automatically clean up operations after 24 hours

// Initialize scheduler if in server environment
if (typeof window === 'undefined') {
  // Import and initialize scheduler on server-side only
  import('./scheduler')
    .then(() => {
      operationsLogger.info('Scheduler initialized')
    })
    .catch(error => {
      operationsLogger.error('Failed to initialize scheduler', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    })
}
