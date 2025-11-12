// portal/src/lib/assessments.ts
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  ScanCommand,
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
    this.tableName =
      config.database.assessmentsTable || config.database.interviewsTable
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
      logger.error('Failed to create interview', {
        interviewId: interview.id,
        error,
      })
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
      logger.error('Failed to create take-home', {
        takeHomeId: takeHome.id,
        error,
      })
      throw error
    }
  }

  /**
   * Retrieves an assessment by ID (works for both interviews and take-homes).
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async getAssessment(id: string): Promise<Assessment | null> {
    logger.debug('getAssessment called', { id })

    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
        })
      )

      if (response.Item) {
        const item = unmarshall(response.Item) as Assessment
        logger.debug('Assessment found', {
          id,
          sessionType: item.sessionType,
        })
        return item
      }

      logger.warn('Assessment not found in database', { id })
      return null
    } catch (error) {
      logger.error('Error looking up assessment', { id, error })
      return null
    }
  }

  /**
   * Retrieves a take-home by access token.
   * Used during candidate activation flow.
   */
  async getTakeHomeByToken(token: string): Promise<TakeHome | null> {
    try {
      // We need to scan to find by accessToken
      // In a production system, this would use a GSI on accessToken
      const response = await this.dynamoClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression:
            'begins_with(PK, :pkPrefix) AND accessToken = :token',
          ExpressionAttributeValues: marshall({
            ':pkPrefix': 'TAKEHOME#',
            ':token': token,
          }),
        })
      )

      if (response.Items && response.Items.length > 0) {
        return unmarshall(response.Items[0]) as TakeHome
      }

      return null
    } catch (error) {
      logger.error('Failed to get take-home by token', { token, error })
      return null
    }
  }

  /**
   * Updates instance status for an assessment.
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async updateInstanceStatus(
    id: string,
    sessionType: 'interview' | 'takehome',
    status: InstanceStatus
  ): Promise<void> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
          UpdateExpression: 'SET instanceStatus = :status',
          ExpressionAttributeValues: marshall({ ':status': status }),
        })
      )

      logger.info('Instance status updated', { id, sessionType, status })
    } catch (error) {
      logger.error('Failed to update instance status', {
        id,
        sessionType,
        status,
        error,
      })
      throw error
    }
  }

  /**
   * Updates session status for an assessment.
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async updateSessionStatus(
    id: string,
    sessionType: 'interview' | 'takehome',
    status: InterviewSessionStatus | TakeHomeSessionStatus
  ): Promise<void> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
          UpdateExpression: 'SET sessionStatus = :status',
          ExpressionAttributeValues: marshall({ ':status': status }),
        })
      )

      logger.info('Session status updated', { id, sessionType, status })
    } catch (error) {
      logger.error('Failed to update session status', {
        id,
        sessionType,
        status,
        error,
      })
      throw error
    }
  }

  /**
   * Updates take-home activation fields (activatedAt, autoDestroyAt, isActivated).
   * Called when candidate activates their take-home assessment.
   */
  async updateTakeHomeActivation(
    id: string,
    activatedAt: number,
    autoDestroyAt: number
  ): Promise<void> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
          UpdateExpression:
            'SET activatedAt = :activatedAt, autoDestroyAt = :autoDestroyAt, isActivated = :isActivated',
          ExpressionAttributeValues: marshall({
            ':activatedAt': activatedAt,
            ':autoDestroyAt': autoDestroyAt,
            ':isActivated': true,
          }),
        })
      )

      logger.info('Take-home activation fields updated', {
        id,
        activatedAt,
        autoDestroyAt,
      })
    } catch (error) {
      logger.error('Failed to update take-home activation', {
        id,
        activatedAt,
        autoDestroyAt,
        error,
      })
      throw error
    }
  }

  /**
   * Updates assessment access credentials (url, password).
   * Called after infrastructure provisioning completes.
   */
  async updateAccessCredentials(
    id: string,
    url: string,
    password: string
  ): Promise<void> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
          UpdateExpression: 'SET #url = :url, password = :password',
          ExpressionAttributeNames: {
            '#url': 'url',
          },
          ExpressionAttributeValues: marshall({
            ':url': url,
            ':password': password,
          }),
        })
      )

      logger.info('Access credentials updated', { id, url })
    } catch (error) {
      logger.error('Failed to update access credentials', { id, error })
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

  /**
   * Lists all take-homes (for manager dashboard).
   * Returns take-homes sorted by creation date descending.
   */
  async listTakeHomes(): Promise<TakeHome[]> {
    try {
      const response = await this.dynamoClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :pkPrefix)',
          ExpressionAttributeValues: marshall({
            ':pkPrefix': 'TAKEHOME#',
          }),
        })
      )

      if (!response.Items || response.Items.length === 0) {
        return []
      }

      const takeHomes = response.Items.map(item => unmarshall(item) as TakeHome)

      // Sort by createdAt descending (newest first)
      return takeHomes.sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      logger.error('Failed to list take-homes', { error })
      throw error
    }
  }

  /**
   * Deletes a take-home record from DynamoDB.
   * Used during take-home deletion (for non-activated assessments).
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async deleteTakeHome(id: string): Promise<void> {
    try {
      const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb')
      await this.dynamoClient.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
        })
      )

      logger.info('TakeHome deleted', { takeHomeId: id })
    } catch (error) {
      logger.error('Failed to delete take-home', { takeHomeId: id, error })
      throw error
    }
  }
}

export const assessmentManager = new AssessmentManager()
