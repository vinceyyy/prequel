import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { config } from './config'

export interface TakehomeTest {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: 'active' | 'activated' | 'completed' | 'revoked'
  validUntil: Date
  durationMinutes: number
  createdAt: Date
  activatedAt?: Date
  interviewId?: string
  createdBy?: string
  ttl?: number
}

export class TakehomeManager {
  private dynamoClient: DynamoDBClient
  private tableName: string

  constructor() {
    this.dynamoClient = new DynamoDBClient({
      region: config.aws.region,
      credentials: config.aws.getCredentials(),
    })
    this.tableName = config.database.takehomeTable
  }

  /**
   * Generates a random 8-character alphanumeric passcode (uppercase).
   */
  generatePasscode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed ambiguous: 0,O,1,I
    let passcode = ''
    for (let i = 0; i < 8; i++) {
      passcode += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return passcode
  }

  /**
   * Creates a new take-home test invitation.
   */
  async createTakehome(params: {
    candidateName: string
    challenge: string
    customInstructions: string
    availabilityWindowDays: number
    durationMinutes: number
  }): Promise<TakehomeTest> {
    const passcode = this.generatePasscode()
    const now = new Date()
    const validUntil = new Date(
      now.getTime() + params.availabilityWindowDays * 24 * 60 * 60 * 1000
    )

    // TTL for DynamoDB (30 days after validUntil for history)
    const ttl = Math.floor(
      (validUntil.getTime() + 30 * 24 * 60 * 60 * 1000) / 1000
    )

    const takehome: TakehomeTest = {
      passcode,
      candidateName: params.candidateName,
      challenge: params.challenge,
      customInstructions: params.customInstructions,
      status: 'active',
      validUntil,
      durationMinutes: params.durationMinutes,
      createdAt: now,
      ttl,
    }

    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(takehome, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(passcode)',
      })
    )

    return takehome
  }

  /**
   * Gets a take-home test by passcode.
   */
  async getTakehome(passcode: string): Promise<TakehomeTest | null> {
    const result = await this.dynamoClient.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ passcode }),
      })
    )

    if (!result.Item) {
      return null
    }

    const item = unmarshall(result.Item)
    return {
      ...item,
      createdAt: new Date(item.createdAt),
      validUntil: new Date(item.validUntil),
      activatedAt: item.activatedAt ? new Date(item.activatedAt) : undefined,
    } as TakehomeTest
  }

  /**
   * Gets all active take-home tests.
   */
  async getActiveTakehomes(): Promise<TakehomeTest[]> {
    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': 'active',
        }),
      })
    )

    if (!result.Items) {
      return []
    }

    return result.Items.map(item => {
      const data = unmarshall(item)
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        validUntil: new Date(data.validUntil),
        activatedAt: data.activatedAt ? new Date(data.activatedAt) : undefined,
      } as TakehomeTest
    })
  }

  /**
   * Activates a take-home test (candidate clicked Start).
   */
  async activateTakehome(
    passcode: string,
    interviewId: string
  ): Promise<boolean> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ passcode }),
          UpdateExpression:
            'SET #status = :activated, activatedAt = :now, interviewId = :interviewId',
          ConditionExpression: '#status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':active': 'active',
            ':activated': 'activated',
            ':now': new Date().toISOString(),
            ':interviewId': interviewId,
          }),
        })
      )
      return true
    } catch (error) {
      console.error('Failed to activate take-home:', error)
      return false
    }
  }

  /**
   * Revokes a take-home test.
   */
  async revokeTakehome(passcode: string): Promise<boolean> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ passcode }),
          UpdateExpression: 'SET #status = :revoked',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':revoked': 'revoked',
          }),
        })
      )
      return true
    } catch (error) {
      console.error('Failed to revoke take-home:', error)
      return false
    }
  }

  /**
   * Marks a take-home test as completed.
   */
  async completeTakehome(passcode: string): Promise<boolean> {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ passcode }),
          UpdateExpression: 'SET #status = :completed',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':completed': 'completed',
          }),
        })
      )
      return true
    } catch (error) {
      console.error('Failed to complete take-home:', error)
      return false
    }
  }
}

export const takehomeManager = new TakehomeManager()
