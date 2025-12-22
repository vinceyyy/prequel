/**
 * API Key Manager for DynamoDB operations.
 * Handles standalone API key records.
 */

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
import { generateId, generateSecureString } from './idGenerator'
import type { ApiKey, ApiKeyStatus } from './types/apikey'

export class ApiKeyManager {
  private readonly dynamoClient: DynamoDBClient
  private readonly tableName: string

  constructor() {
    this.dynamoClient = new DynamoDBClient(config.aws.getCredentials())
    this.tableName = config.database.apikeysTable
  }

  /**
   * Creates a new API key record in DynamoDB
   */
  async createApiKey(
    apiKey: Omit<ApiKey, 'id' | 'createdAt' | 'ttl'>
  ): Promise<ApiKey> {
    const now = Math.floor(Date.now() / 1000)
    const id = generateId()
    const accessToken =
      apiKey.activationMode === 'recipient' ? generateSecureString() : undefined

    const fullApiKey: ApiKey = {
      ...apiKey,
      id,
      accessToken,
      createdAt: now,
    }

    // Set TTL for 90 days after expiration (or creation if no expiration yet)
    const ttlBase = fullApiKey.expiresAt || now
    fullApiKey.ttl = ttlBase + 90 * 24 * 60 * 60

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(fullApiKey, { removeUndefinedValues: true }),
        })
      )

      logger.info('API key created', { apiKeyId: id, name: apiKey.name })
      return fullApiKey
    } catch (error) {
      logger.error('Failed to create API key', { error })
      throw error
    }
  }

  /**
   * Retrieves an API key by ID
   */
  async getApiKey(id: string): Promise<ApiKey | null> {
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

      return unmarshall(response.Item) as ApiKey
    } catch (error) {
      logger.error('Failed to get API key', { id, error })
      throw error
    }
  }

  /**
   * Retrieves an API key by access token (for candidate page)
   */
  async getApiKeyByToken(token: string): Promise<ApiKey | null> {
    try {
      const response = await this.dynamoClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'accessToken-index',
          KeyConditionExpression: 'accessToken = :token',
          ExpressionAttributeValues: marshall({ ':token': token }),
        })
      )

      if (!response.Items || response.Items.length === 0) {
        return null
      }

      return unmarshall(response.Items[0]) as ApiKey
    } catch (error) {
      logger.error('Failed to get API key by token', { error })
      throw error
    }
  }

  /**
   * Updates API key status
   */
  async updateStatus(
    id: string,
    status: ApiKeyStatus,
    updates: Partial<
      Pick<
        ApiKey,
        | 'activatedAt'
        | 'expiresAt'
        | 'expiredAt'
        | 'serviceAccountId'
        | 'apiKey'
      >
    > = {}
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)

    let updateExpression = 'SET #status = :status, updatedAt = :updatedAt'
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    }
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': now,
    }

    // Add optional updates
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateExpression += `, ${key} = :${key}`
        expressionAttributeValues[`:${key}`] = value
      }
    })

    // Update TTL if we have an expiration time
    if (updates.expiresAt) {
      updateExpression += ', #ttl = :ttl'
      expressionAttributeNames['#ttl'] = 'ttl'
      expressionAttributeValues[':ttl'] = updates.expiresAt + 90 * 24 * 60 * 60
    }

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

      logger.info('API key status updated', { id, status })
    } catch (error) {
      logger.error('Failed to update API key status', { id, status, error })
      throw error
    }
  }

  /**
   * Gets all API keys by status
   */
  async getKeysByStatus(statuses: ApiKeyStatus[]): Promise<ApiKey[]> {
    const keys: ApiKey[] = []

    try {
      for (const status of statuses) {
        const response = await this.dynamoClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'status-createdAt-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({ ':status': status }),
            ScanIndexForward: false,
          })
        )

        if (response.Items) {
          keys.push(...response.Items.map(item => unmarshall(item) as ApiKey))
        }
      }

      return keys.sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      logger.error('Failed to get API keys by status', { statuses, error })
      throw error
    }
  }

  /**
   * Gets all active API keys (scheduled, available, active)
   */
  async getActiveKeys(): Promise<ApiKey[]> {
    return this.getKeysByStatus(['scheduled', 'available', 'active'])
  }

  /**
   * Gets all historical API keys (expired, revoked, error)
   */
  async getHistoricalKeys(): Promise<ApiKey[]> {
    return this.getKeysByStatus(['expired', 'revoked', 'error'])
  }

  /**
   * Gets keys that need to be processed by scheduler
   */
  async getScheduledKeys(): Promise<ApiKey[]> {
    return this.getKeysByStatus(['scheduled'])
  }

  /**
   * Gets active keys that have expired
   */
  async getExpiredActiveKeys(): Promise<ApiKey[]> {
    const now = Math.floor(Date.now() / 1000)
    const activeKeys = await this.getKeysByStatus(['active'])
    return activeKeys.filter(key => key.expiresAt && key.expiresAt <= now)
  }

  /**
   * Gets available keys that are past their availability window
   */
  async getExpiredAvailableKeys(): Promise<ApiKey[]> {
    const now = Math.floor(Date.now() / 1000)
    const availableKeys = await this.getKeysByStatus(['available'])
    return availableKeys.filter(
      key => key.availableUntil && key.availableUntil <= now
    )
  }

  /**
   * Deletes an API key record
   */
  async deleteApiKey(id: string): Promise<void> {
    try {
      await this.dynamoClient.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({ id }),
        })
      )

      logger.info('API key deleted', { id })
    } catch (error) {
      logger.error('Failed to delete API key', { id, error })
      throw error
    }
  }
}

// Singleton instance
export const apiKeyManager = new ApiKeyManager()
