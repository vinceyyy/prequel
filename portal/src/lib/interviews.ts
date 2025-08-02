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

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const INTERVIEWS_TABLE_NAME = process.env.INTERVIEWS_TABLE_NAME || 'prequel-dev-interviews'

/**
 * Standardized interview status values for the lifecycle of an interview.
 * These are different from operation statuses and represent the user-facing state.
 */
export type InterviewStatus =
  | 'scheduled'    // Waiting for scheduled start time
  | 'initializing' // Terraform provisioning AWS resources  
  | 'configuring'  // Infrastructure ready, ECS container booting
  | 'active'       // Fully ready for candidate access
  | 'destroying'   // Infrastructure being torn down
  | 'destroyed'    // Infrastructure completely removed
  | 'error'        // Failed state requiring manual intervention

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
    const clientConfig = { region: AWS_REGION }
    this.dynamoClient = new DynamoDBClient(clientConfig)
    this.tableName = INTERVIEWS_TABLE_NAME
  }

  /**
   * Creates a new interview record in DynamoDB.
   */
  async createInterview(interview: Omit<Interview, 'createdAt' | 'ttl'>): Promise<Interview> {
    const now = new Date()
    const fullInterview: Interview = {
      ...interview,
      createdAt: now,
    }

    // Set TTL for 90 days after creation (converted to Unix timestamp)
    if (interview.status === 'destroyed' || interview.status === 'error') {
      fullInterview.ttl = Math.floor((now.getTime() + 90 * 24 * 60 * 60 * 1000) / 1000)
    }

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(this.interviewToDynamoItem(fullInterview)),
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
      logger.error('Failed to get interview from DynamoDB', { interviewId: id, error })
      throw error
    }
  }

  /**
   * Updates interview status and metadata.
   */
  async updateInterviewStatus(
    id: string,
    status: InterviewStatus,
    updates: Partial<Pick<Interview, 'accessUrl' | 'password' | 'completedAt' | 'destroyedAt' | 'historyS3Key'>> = {}
  ): Promise<void> {
    const now = new Date()
    
    let updateExpression = 'SET #status = :status, updatedAt = :updatedAt'
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' }
    const expressionAttributeValues: Record<string, any> = {
      ':status': status,
      ':updatedAt': Math.floor(now.getTime() / 1000),
    }

    // Add completion timestamp for terminal states
    if (status === 'destroyed' || status === 'error') {
      updateExpression += ', completedAt = :completedAt'
      expressionAttributeValues[':completedAt'] = Math.floor(now.getTime() / 1000)
      
      // Set TTL for cleanup after 90 days
      updateExpression += ', ttl = :ttl'
      expressionAttributeValues[':ttl'] = Math.floor((now.getTime() + 90 * 24 * 60 * 60 * 1000) / 1000)
    }

    if (status === 'destroyed' && !updates.destroyedAt) {
      updateExpression += ', destroyedAt = :destroyedAt'
      expressionAttributeValues[':destroyedAt'] = Math.floor(now.getTime() / 1000)
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

      logger.info('Interview status updated', { interviewId: id, status, updates })
    } catch (error) {
      logger.error('Failed to update interview status', { interviewId: id, status, error })
      throw error
    }
  }

  /**
   * Gets active interviews (not in terminal states).
   * Uses GSI for efficient querying by status.
   */
  async getActiveInterviews(): Promise<Interview[]> {
    const activeStatuses: InterviewStatus[] = ['scheduled', 'initializing', 'configuring', 'active', 'destroying']
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
  async searchByCandidate(candidateName: string, limit: number = 20): Promise<Interview[]> {
    try {
      const response = await this.dynamoClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'candidateName-createdAt-index',
          KeyConditionExpression: 'candidateName = :candidateName',
          ExpressionAttributeValues: marshall({ ':candidateName': candidateName }),
          ScanIndexForward: false, // Sort by createdAt descending (newest first)
          Limit: limit,
        })
      )

      if (!response.Items) {
        return []
      }

      return response.Items.map(item => this.dynamoItemToInterview(unmarshall(item)))
    } catch (error) {
      logger.error('Failed to search interviews by candidate', { candidateName, error })
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
   */
  private interviewToDynamoItem(interview: Interview): Record<string, any> {
    return {
      ...interview,
      createdAt: Math.floor(interview.createdAt.getTime() / 1000),
      scheduledAt: interview.scheduledAt ? Math.floor(interview.scheduledAt.getTime() / 1000) : undefined,
      autoDestroyAt: interview.autoDestroyAt ? Math.floor(interview.autoDestroyAt.getTime() / 1000) : undefined,
      completedAt: interview.completedAt ? Math.floor(interview.completedAt.getTime() / 1000) : undefined,
      destroyedAt: interview.destroyedAt ? Math.floor(interview.destroyedAt.getTime() / 1000) : undefined,
    }
  }

  /**
   * Converts DynamoDB item to Interview object.
   */
  private dynamoItemToInterview(item: Record<string, any>): Interview {
    return {
      ...item,
      createdAt: new Date(item.createdAt * 1000),
      scheduledAt: item.scheduledAt ? new Date(item.scheduledAt * 1000) : undefined,
      autoDestroyAt: item.autoDestroyAt ? new Date(item.autoDestroyAt * 1000) : undefined,
      completedAt: item.completedAt ? new Date(item.completedAt * 1000) : undefined,
      destroyedAt: item.destroyedAt ? new Date(item.destroyedAt * 1000) : undefined,
    } as Interview
  }
}

// Singleton instance
export const interviewManager = new InterviewManager()