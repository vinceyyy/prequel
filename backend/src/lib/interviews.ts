import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { logger } from './logger'
import { config } from './config'

/**
 * Standardized interview status values for the lifecycle of an interview.
 * These are different from operation statuses and represent the user-facing state.
 */
export type InterviewStatus =
  | 'scheduled' // Waiting for scheduled start time
  | 'initializing' // Terraform provisioning AWS resources
  | 'configuring' // Infrastructure ready, ECS container booting
  | 'active' // Fully ready for candidate access
  | 'destroying' // Infrastructure being torn down
  | 'destroyed' // Infrastructure completely removed
  | 'error' // Failed state requiring manual intervention

/**
 * Interview record stored in DynamoDB.
 * This serves as the source of truth for interview state and metadata.
 */
export interface Interview {
  id: string
  candidateName: string
  challenge: string
  status: InterviewStatus

  // Access details (available when status is 'active')
  accessUrl?: string
  password?: string

  // OpenAI service account details
  openaiServiceAccountId?: string
  openaiApiKey?: string

  // Scheduling information
  createdAt: Date
  scheduledAt?: Date
  autoDestroyAt?: Date

  // Completion information (for history)
  completedAt?: Date
  destroyedAt?: Date

  // File extraction metadata
  saveFiles?: boolean
  historyS3Key?: string // S3 key where candidate files are stored

  // TTL for automatic cleanup (90 days after completion)
  ttl?: number
}

/**
 * Interview record as stored in DynamoDB (with Unix timestamps).
 * This interface represents the actual DynamoDB item structure.
 *
 * Note: This interface is used for type checking but not runtime validation.
 * We trust that DynamoDB unmarshall returns the correct structure.
 */
interface InterviewDynamoItem {
  id: string
  candidateName: string
  challenge: string
  status: InterviewStatus
  accessUrl?: string
  password?: string

  // OpenAI service account details
  openaiServiceAccountId?: string
  openaiApiKey?: string

  // Timestamps stored as Unix seconds in DynamoDB
  createdAt: number
  scheduledAt?: number
  autoDestroyAt?: number
  completedAt?: number
  destroyedAt?: number

  saveFiles?: boolean
  historyS3Key?: string
  ttl?: number
}

/**
 * Interview manager for DynamoDB operations.
 *
 * This service manages the complete interview lifecycle in DynamoDB,
 * providing fast queries and serving as the source of truth for
 * interview state instead of S3-based polling.
 */
export class InterviewManager {
  private readonly dynamoClient: DynamoDBClient
  private readonly tableName: string

  constructor() {
    this.dynamoClient = new DynamoDBClient(config.aws.getCredentials())
    this.tableName = config.database.interviewsTable
  }

  /**
   * Creates a new interview record in DynamoDB.
   */
  async createInterview(
    interview: Omit<Interview, 'createdAt' | 'ttl'>
  ): Promise<Interview> {
    const now = new Date()
    const fullInterview: Interview = {
      ...interview,
      createdAt: now,
    }

    // Set TTL for 90 days after creation (converted to Unix timestamp)
    if (interview.status === 'destroyed' || interview.status === 'error') {
      fullInterview.ttl = Math.floor(
        (now.getTime() + 90 * 24 * 60 * 60 * 1000) / 1000
      )
    }

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(this.interviewToDynamoItem(fullInterview), {
            removeUndefinedValues: true,
          }),
        })
      )

      logger.info('Interview created in DynamoDB', {
        interviewId: interview.id,
        candidateName: interview.candidateName,
        status: interview.status,
      })

      return fullInterview
    } catch (error) {
      logger.error('Failed to create interview in DynamoDB', {
        interviewId: interview.id,
        error,
      })
      throw error
    }
  }

  /**
   * Retrieves an interview by ID.
   */
  async getInterview(id: string): Promise<Interview | null> {
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
        })
      )

      if (!response.Item) {
        return null
      }

      return this.dynamoItemToInterview(unmarshall(response.Item))
    } catch (error) {
      logger.error('Failed to get interview from DynamoDB', {
        interviewId: id,
        error,
      })
      throw error
    }
  }

  /**
   * Updates interview status and metadata.
   */
  async updateInterviewStatus(
    id: string,
    status: InterviewStatus,
    updates: Partial<
      Pick<
        Interview,
        | 'accessUrl'
        | 'password'
        | 'completedAt'
        | 'destroyedAt'
        | 'historyS3Key'
      >
    > = {}
  ): Promise<void> {
    const now = new Date()

    let updateExpression = 'SET #status = :status, updatedAt = :updatedAt'
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    }
    const expressionAttributeValues: Record<string, string | number> = {
      ':status': status,
      ':updatedAt': Math.floor(now.getTime() / 1000),
    }

    // Add completion timestamp for terminal states
    if (status === 'destroyed' || status === 'error') {
      updateExpression += ', completedAt = :completedAt'
      expressionAttributeValues[':completedAt'] = Math.floor(
        now.getTime() / 1000
      )

      // Set TTL for cleanup after 90 days
      updateExpression += ', #ttl = :ttl'
      expressionAttributeNames['#ttl'] = 'ttl'
      expressionAttributeValues[':ttl'] = Math.floor(
        (now.getTime() + 90 * 24 * 60 * 60 * 1000) / 1000
      )
    }

    if (status === 'destroyed' && !updates.destroyedAt) {
      updateExpression += ', destroyedAt = :destroyedAt'
      expressionAttributeValues[':destroyedAt'] = Math.floor(
        now.getTime() / 1000
      )
    }

    // Add optional updates
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateExpression += `, ${key} = :${key}`
        expressionAttributeValues[`:${key}`] =
          value instanceof Date ? Math.floor(value.getTime() / 1000) : value
      }
    })

    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: marshall(expressionAttributeValues),
        })
      )

      logger.info('Interview status updated', {
        interviewId: id,
        status,
        updates,
      })
    } catch (error) {
      logger.error('Failed to update interview status', {
        interviewId: id,
        status,
        error,
      })
      throw error
    }
  }

  /**
   * Gets active interviews (not in terminal states).
   * Uses GSI for efficient querying by status.
   */
  async getActiveInterviews(): Promise<Interview[]> {
    const activeStatuses: InterviewStatus[] = [
      'scheduled',
      'initializing',
      'configuring',
      'active',
      'destroying',
    ]
    const interviews: Interview[] = []

    try {
      for (const status of activeStatuses) {
        const response = await this.dynamoClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'status-createdAt-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({ ':status': status }),
            ScanIndexForward: false, // Sort by createdAt descending (newest first)
          })
        )

        if (response.Items) {
          const statusInterviews = response.Items.map(item =>
            this.dynamoItemToInterview(unmarshall(item))
          )
          interviews.push(...statusInterviews)
        }
      }

      // Sort all interviews by creation date (newest first)
      interviews.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      return interviews
    } catch (error) {
      logger.error('Failed to get active interviews', { error })
      throw error
    }
  }

  /**
   * Gets historical interviews (completed or failed).
   * Uses GSI for efficient querying by status.
   */
  async getHistoricalInterviews(limit: number = 50): Promise<Interview[]> {
    const historicalStatuses: InterviewStatus[] = ['destroyed', 'error']
    const interviews: Interview[] = []

    try {
      for (const status of historicalStatuses) {
        const response = await this.dynamoClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'status-createdAt-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({ ':status': status }),
            ScanIndexForward: false, // Sort by createdAt descending (newest first)
            Limit: Math.ceil(limit / historicalStatuses.length), // Distribute limit across statuses
          })
        )

        if (response.Items) {
          const statusInterviews = response.Items.map(item =>
            this.dynamoItemToInterview(unmarshall(item))
          )
          interviews.push(...statusInterviews)
        }
      }

      // Sort all interviews by completion date (newest first)
      interviews.sort((a, b) => {
        const aTime = a.completedAt?.getTime() || a.createdAt.getTime()
        const bTime = b.completedAt?.getTime() || b.createdAt.getTime()
        return bTime - aTime
      })

      return interviews.slice(0, limit)
    } catch (error) {
      logger.error('Failed to get historical interviews', { error })
      throw error
    }
  }

  /**
   * Searches interviews by candidate name.
   */
  async searchByCandidate(
    candidateName: string,
    limit: number = 20
  ): Promise<Interview[]> {
    try {
      const response = await this.dynamoClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'candidateName-createdAt-index',
          KeyConditionExpression: 'candidateName = :candidateName',
          ExpressionAttributeValues: marshall({
            ':candidateName': candidateName,
          }),
          ScanIndexForward: false, // Sort by createdAt descending (newest first)
          Limit: limit,
        })
      )

      if (!response.Items) {
        return []
      }

      return response.Items.map(item =>
        this.dynamoItemToInterview(unmarshall(item))
      )
    } catch (error) {
      logger.error('Failed to search interviews by candidate', {
        candidateName,
        error,
      })
      throw error
    }
  }

  /**
   * Deletes an interview record (for cleanup).
   */
  async deleteInterview(id: string): Promise<void> {
    try {
      await this.dynamoClient.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
        })
      )

      logger.info('Interview deleted from DynamoDB', { interviewId: id })
    } catch (error) {
      logger.error('Failed to delete interview', { interviewId: id, error })
      throw error
    }
  }

  /**
   * Converts Interview object to DynamoDB item format.
   * Converts Date objects to Unix timestamps for DynamoDB storage.
   */
  private interviewToDynamoItem(interview: Interview): InterviewDynamoItem {
    return {
      ...interview,
      createdAt: Math.floor(interview.createdAt.getTime() / 1000),
      scheduledAt: interview.scheduledAt
        ? Math.floor(interview.scheduledAt.getTime() / 1000)
        : undefined,
      autoDestroyAt: interview.autoDestroyAt
        ? Math.floor(interview.autoDestroyAt.getTime() / 1000)
        : undefined,
      completedAt: interview.completedAt
        ? Math.floor(interview.completedAt.getTime() / 1000)
        : undefined,
      destroyedAt: interview.destroyedAt
        ? Math.floor(interview.destroyedAt.getTime() / 1000)
        : undefined,
    }
  }

  /**
   * Converts DynamoDB item to Interview object.
   * Converts Unix timestamps back to Date objects.
   */
  private dynamoItemToInterview(item: Record<string, unknown>): Interview {
    // Cast to our expected interface (we trust DynamoDB unmarshall structure)
    const dynamoItem = item as unknown as InterviewDynamoItem
    return {
      ...dynamoItem,
      createdAt: new Date(dynamoItem.createdAt * 1000),
      scheduledAt: dynamoItem.scheduledAt
        ? new Date(dynamoItem.scheduledAt * 1000)
        : undefined,
      autoDestroyAt: dynamoItem.autoDestroyAt
        ? new Date(dynamoItem.autoDestroyAt * 1000)
        : undefined,
      completedAt: dynamoItem.completedAt
        ? new Date(dynamoItem.completedAt * 1000)
        : undefined,
      destroyedAt: dynamoItem.destroyedAt
        ? new Date(dynamoItem.destroyedAt * 1000)
        : undefined,
    } as Interview
  }

  /**
   * High-level method to create a complete interview with infrastructure and DynamoDB tracking.
   * This orchestrates terraform operations and maintains DynamoDB as the source of truth.
   */
  async createInterviewWithInfrastructure(
    instance: {
      id: string
      candidateName: string
      challenge: string
      password: string
      openaiApiKey: string | undefined
    },
    onData?: (data: string) => void,
    onInfrastructureReady?: (accessUrl: string) => void,
    scheduledAt?: Date,
    autoDestroyAt?: Date,
    saveFiles?: boolean,
    openaiServiceAccountId?: string
  ): Promise<{
    success: boolean
    error?: string
    accessUrl?: string
    healthCheckPassed?: boolean
    infrastructureReady?: boolean
    fullOutput?: string
  }> {
    try {
      // Create DynamoDB record first
      await this.createInterview({
        id: instance.id,
        candidateName: instance.candidateName,
        challenge: instance.challenge,
        status: 'initializing',
        scheduledAt,
        autoDestroyAt,
        saveFiles,
        openaiServiceAccountId,
        openaiApiKey: instance.openaiApiKey,
      })

      if (onData) {
        onData('Created interview record in DynamoDB\n')
      }

      // Import terraform manager here to avoid circular dependency
      const { terraformManager } = await import('./terraform')

      // Create infrastructure with terraform
      const result = await terraformManager.createInterviewStreaming(
        instance,
        onData,
        async (accessUrl: string) => {
          // Update DynamoDB when infrastructure is ready but don't expose URL yet
          await this.updateInterviewStatus(instance.id, 'configuring')

          if (onInfrastructureReady) {
            onInfrastructureReady(accessUrl)
          }
        }
      )

      if (result.success) {
        // Update DynamoDB to active status with access details
        await this.updateInterviewStatus(instance.id, 'active', {
          accessUrl: result.accessUrl,
          password: instance.password,
        })

        return {
          success: true,
          accessUrl: result.accessUrl,
          healthCheckPassed: result.healthCheckPassed,
          infrastructureReady: result.infrastructureReady,
          fullOutput: result.fullOutput,
        }
      } else {
        // Update DynamoDB to error status
        await this.updateInterviewStatus(instance.id, 'error')

        return {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput,
        }
      }
    } catch (error) {
      // Update DynamoDB to error status
      try {
        await this.updateInterviewStatus(instance.id, 'error')
      } catch (dbError) {
        logger.error('Failed to update interview status to error', {
          interviewId: instance.id,
          error: dbError,
        })
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  /**
   * High-level method to destroy interview infrastructure and update DynamoDB tracking.
   * This orchestrates terraform destruction and maintains DynamoDB consistency.
   */
  async destroyInterviewWithInfrastructure(
    interviewId: string,
    onData?: (data: string) => void,
    candidateName?: string,
    challenge?: string,
    saveFiles?: boolean
  ): Promise<{
    success: boolean
    error?: string
    historyS3Key?: string
    fullOutput?: string
  }> {
    try {
      // Update DynamoDB to destroying status
      await this.updateInterviewStatus(interviewId, 'destroying')

      if (onData) {
        onData('Updated interview status to destroying in DynamoDB\n')
      }

      // Import terraform manager here to avoid circular dependency
      const { terraformManager } = await import('./terraform')

      // Destroy infrastructure with terraform
      const result = await terraformManager.destroyInterviewStreaming(
        interviewId,
        onData,
        candidateName,
        challenge,
        saveFiles
      )

      if (result.success) {
        // Update DynamoDB to destroyed status with history key
        await this.updateInterviewStatus(interviewId, 'destroyed', {
          historyS3Key: result.historyS3Key,
          destroyedAt: new Date(),
        })

        return {
          success: true,
          historyS3Key: result.historyS3Key,
          fullOutput: result.fullOutput,
        }
      } else {
        // Update DynamoDB to error status
        await this.updateInterviewStatus(interviewId, 'error')

        return {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput,
        }
      }
    } catch (error) {
      // Update DynamoDB to error status
      try {
        await this.updateInterviewStatus(interviewId, 'error')
      } catch (dbError) {
        logger.error('Failed to update interview status to error', {
          interviewId,
          error: dbError,
        })
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        error: errorMsg,
      }
    }
  }
}

// Singleton instance
export const interviewManager = new InterviewManager()
