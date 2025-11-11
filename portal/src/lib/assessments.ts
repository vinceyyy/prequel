// portal/src/lib/assessments.ts
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { logger } from './logger'
import { config } from './config'
import type {
  Interview,
  TakeHome,
  Assessment,
  InstanceStatus,
  InterviewSessionStatus,
  TakeHomeSessionStatus,
} from './types/assessment'

/**
 * Assessment manager for DynamoDB operations.
 * Handles both Interview and TakeHome records in the assessments table.
 */
export class AssessmentManager {
  private readonly dynamoClient: DynamoDBClient
  private readonly tableName: string

  constructor() {
    this.dynamoClient = new DynamoDBClient(config.aws.getCredentials())
    this.tableName = config.database.assessmentsTable || config.database.interviewsTable
  }

  /**
   * Creates a new interview record.
   */
  async createInterview(
    interview: Omit<Interview, 'createdAt'>
  ): Promise<Interview> {
    const now = Math.floor(Date.now() / 1000)
    const fullInterview: Interview = {
      ...interview,
      createdAt: now,
    }

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(fullInterview, { removeUndefinedValues: true }),
        })
      )

      logger.info('Interview created', { interviewId: interview.id })
      return fullInterview
    } catch (error) {
      logger.error('Failed to create interview', { interviewId: interview.id, error })
      throw error
    }
  }

  /**
   * Creates a new take-home record.
   */
  async createTakeHome(
    takeHome: Omit<TakeHome, 'createdAt'>
  ): Promise<TakeHome> {
    const now = Math.floor(Date.now() / 1000)
    const fullTakeHome: TakeHome = {
      ...takeHome,
      createdAt: now,
    }

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(fullTakeHome, { removeUndefinedValues: true }),
        })
      )

      logger.info('TakeHome created', { takeHomeId: takeHome.id })
      return fullTakeHome
    } catch (error) {
      logger.error('Failed to create take-home', { takeHomeId: takeHome.id, error })
      throw error
    }
  }

  /**
   * Retrieves an assessment by ID (works for both interviews and take-homes).
   */
  async getAssessment(id: string): Promise<Assessment | null> {
    // Try interview first
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: `INTERVIEW#${id}`, SK: 'METADATA' }),
        })
      )

      if (response.Item) {
        return unmarshall(response.Item) as Interview
      }
    } catch (error) {
      logger.debug('Not found as interview, trying take-home', { id })
    }

    // Try take-home
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: `TAKEHOME#${id}`, SK: 'METADATA' }),
        })
      )

      if (response.Item) {
        return unmarshall(response.Item) as TakeHome
      }
    } catch (error) {
      logger.error('Failed to get assessment', { id, error })
    }

    return null
  }

  /**
   * Updates instance status for an assessment.
   */
  async updateInstanceStatus(
    id: string,
    sessionType: 'interview' | 'takehome',
    status: InstanceStatus
  ): Promise<void> {
    const pk = sessionType === 'interview' ? `INTERVIEW#${id}` : `TAKEHOME#${id}`

    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: pk, SK: 'METADATA' }),
          UpdateExpression: 'SET instanceStatus = :status',
          ExpressionAttributeValues: marshall({ ':status': status }),
        })
      )

      logger.info('Instance status updated', { id, sessionType, status })
    } catch (error) {
      logger.error('Failed to update instance status', { id, sessionType, status, error })
      throw error
    }
  }

  /**
   * Updates session status for an assessment.
   */
  async updateSessionStatus(
    id: string,
    sessionType: 'interview' | 'takehome',
    status: InterviewSessionStatus | TakeHomeSessionStatus
  ): Promise<void> {
    const pk = sessionType === 'interview' ? `INTERVIEW#${id}` : `TAKEHOME#${id}`

    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: pk, SK: 'METADATA' }),
          UpdateExpression: 'SET sessionStatus = :status',
          ExpressionAttributeValues: marshall({ ':status': status }),
        })
      )

      logger.info('Session status updated', { id, sessionType, status })
    } catch (error) {
      logger.error('Failed to update session status', { id, sessionType, status, error })
      throw error
    }
  }

  /**
   * Gets active interviews (not completed).
   */
  async getActiveInterviews(): Promise<Interview[]> {
    // Implementation will query by sessionStatus GSI
    // For now, return empty array
    return []
  }

  /**
   * Gets available take-homes (not activated or expired).
   */
  async getAvailableTakeHomes(): Promise<TakeHome[]> {
    // Implementation will query by sessionStatus GSI
    // For now, return empty array
    return []
  }
}

export const assessmentManager = new AssessmentManager()
