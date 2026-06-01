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

/**
 * ECS container configuration for a challenge.
 * Defines the compute resources needed to run the challenge.
 */
export interface ECSConfiguration {
  /** CPU units (256, 512, 1024, 2048, 4096) */
  cpu: number
  /** Memory in MB (512, 1024, 2048, 4096, 8192, 16384) */
  memory: number
  /** Storage in GB (20-200) */
  storage: number
}

/**
 * File metadata for tracking challenge file structure.
 */
export interface ChallengeFile {
  /** Relative path within the challenge folder */
  path: string
  /** File size in bytes */
  size: number
  /** MIME type */
  mimeType: string
  /** Last modified timestamp */
  lastModified: Date
}

/**
 * Challenge record stored in DynamoDB.
 * This serves as the centralized registry for all interview challenges.
 */
export interface Challenge {
  /** Unique challenge identifier */
  id: string
  /** Display name for the challenge */
  name: string
  /** Challenge description */
  description: string

  /** Whether the challenge is active (soft delete) - stored as string for DynamoDB GSI */
  isActive: string

  /** List of files in the challenge (stored in S3 under challengeId folder) */
  files: ChallengeFile[]

  /** ECS container configuration */
  ecsConfig: ECSConfiguration

  /** Usage statistics */
  usageCount: number
  lastUsedAt?: Date

  /** Audit trail */
  createdAt: Date
  updatedAt: Date
  createdBy: string

  /** Optional TTL for automatic cleanup (90 days default) */
  ttl?: number
}

/**
 * Input for creating a new challenge.
 */
export interface CreateChallengeInput {
  id?: string // Optional - if not provided, will auto-generate
  name: string
  description: string
  files: ChallengeFile[]
  ecsConfig: ECSConfiguration
  createdBy: string
}

/**
 * Input for updating an existing challenge.
 */
export interface UpdateChallengeInput {
  name?: string
  description?: string
  ecsConfig?: ECSConfiguration
  files?: ChallengeFile[]
}

/**
 * DynamoDB client instance configured for the current environment.
 */
const dynamoClient = new DynamoDBClient(config.aws.getCredentials())

/**
 * Service class for managing challenge CRUD operations.
 */
export class ChallengeService {
  private tableName = config.database.challengesTable

  /**
   * Convert DynamoDB item timestamps back to Date objects.
   */
  private convertTimestampsToDate(item: Record<string, unknown>): Challenge {
    return {
      ...item,
      createdAt: new Date(item.createdAt as number),
      updatedAt: new Date(item.updatedAt as number),
      lastUsedAt: item.lastUsedAt
        ? new Date(item.lastUsedAt as number)
        : undefined,
    } as Challenge
  }

  /**
   * Create a new challenge in the database.
   */
  async createChallenge(input: CreateChallengeInput): Promise<Challenge> {
    const now = new Date()
    const challenge: Challenge = {
      id:
        input.id ||
        `challenge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: input.name,
      description: input.description,
      isActive: 'true',
      files: input.files,
      ecsConfig: input.ecsConfig,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      ttl: Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60, // 90 days
    }

    // Convert dates to timestamps for DynamoDB storage and GSI compatibility
    const challengeForStorage = {
      ...challenge,
      createdAt: challenge.createdAt.getTime(),
      updatedAt: challenge.updatedAt.getTime(),
      lastUsedAt: challenge.lastUsedAt?.getTime(),
    }

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(challengeForStorage, {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      }),
      ConditionExpression: 'attribute_not_exists(id)',
    })

    try {
      await dynamoClient.send(command)
      logger.info(`Challenge created: ${challenge.id}`)
      return challenge
    } catch (error) {
      logger.error(
        `Failed to create challenge: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      throw new Error(`Failed to create challenge: ${error}`)
    }
  }

  /**
   * Retrieve a challenge by ID.
   */
  async getChallenge(id: string): Promise<Challenge | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
    })

    try {
      const result = await dynamoClient.send(command)
      if (!result.Item) {
        return null
      }

      const item = unmarshall(result.Item)
      return this.convertTimestampsToDate(item)
    } catch (error) {
      logger.error(
        `Failed to get challenge ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      throw new Error(`Failed to get challenge: ${error}`)
    }
  }

  /**
   * List all active challenges, optionally sorted by different criteria.
   */
  async listChallenges(
    sortBy: 'newest' | 'usage' | 'lastUsed' = 'newest'
  ): Promise<Challenge[]> {
    let indexName: string

    switch (sortBy) {
      case 'usage':
        indexName = 'isActive-usageCount-index'
        break
      case 'lastUsed':
        indexName = 'isActive-lastUsedAt-index'
        break
      case 'newest':
      default:
        indexName = 'isActive-createdAt-index'
        break
    }

    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: indexName,
      KeyConditionExpression: 'isActive = :isActive',
      ExpressionAttributeValues: marshall({
        ':isActive': 'true',
      }),
      ScanIndexForward: sortBy === 'newest' ? false : true, // DESC for newest, ASC for others
    })

    try {
      const result = await dynamoClient.send(command)
      const challenges =
        result.Items?.map(item =>
          this.convertTimestampsToDate(unmarshall(item))
        ) || []

      logger.info(
        `Listed ${challenges.length} active challenges (sorted by ${sortBy})`
      )
      return challenges
    } catch (error) {
      logger.error(
        `Failed to list challenges: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      throw new Error(`Failed to list challenges: ${error}`)
    }
  }

  /**
   * Update an existing challenge.
   */
  async updateChallenge(
    id: string,
    input: UpdateChallengeInput
  ): Promise<Challenge> {
    const now = new Date()

    // Build update expression dynamically based on provided fields
    const updateExpressions: string[] = []
    const attributeNames: Record<string, string> = {}
    const attributeValues: Record<string, unknown> = {
      ':updatedAt': now.getTime(),
    } // Store as timestamp

    if (input.name !== undefined) {
      updateExpressions.push('#name = :name')
      attributeNames['#name'] = 'name'
      attributeValues[':name'] = input.name
    }

    if (input.description !== undefined) {
      updateExpressions.push('description = :description')
      attributeValues[':description'] = input.description
    }

    if (input.ecsConfig !== undefined) {
      updateExpressions.push('ecsConfig = :ecsConfig')
      attributeValues[':ecsConfig'] = input.ecsConfig
    }

    if (input.files !== undefined) {
      updateExpressions.push('files = :files')
      attributeValues[':files'] = input.files
    }

    updateExpressions.push('updatedAt = :updatedAt')

    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames:
        Object.keys(attributeNames).length > 0 ? attributeNames : undefined,
      ExpressionAttributeValues: marshall(
        {
          ...attributeValues,
          ':true': 'true',
        },
        {
          removeUndefinedValues: true,
          convertClassInstanceToMap: true,
        }
      ),
      ReturnValues: 'ALL_NEW',
      ConditionExpression: 'attribute_exists(id) AND isActive = :true',
    })

    try {
      const result = await dynamoClient.send(command)
      const updatedItem = unmarshall(result.Attributes!)
      const updatedChallenge = this.convertTimestampsToDate(updatedItem)

      logger.info(`Challenge updated: ${id}`)
      return updatedChallenge
    } catch (error) {
      logger.error(
        `Failed to update challenge ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      throw new Error(`Failed to update challenge: ${error}`)
    }
  }

  /**
   * Soft delete a challenge (mark as inactive).
   */
  async deleteChallenge(id: string): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
      UpdateExpression: 'SET isActive = :false, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall(
        {
          ':false': 'false',
          ':updatedAt': Date.now(), // Store as timestamp
          ':true': 'true',
        },
        {
          removeUndefinedValues: true,
          convertClassInstanceToMap: true,
        }
      ),
      ConditionExpression: 'attribute_exists(id) AND isActive = :true',
    })

    try {
      await dynamoClient.send(command)
      logger.info(`Challenge deleted (soft): ${id}`)
    } catch (error) {
      logger.error(
        `Failed to delete challenge ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      throw new Error(`Failed to delete challenge: ${error}`)
    }
  }

  /**
   * Increment usage count and update last used timestamp.
   */
  async incrementUsage(id: string): Promise<void> {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
      UpdateExpression:
        'SET usageCount = usageCount + :inc, lastUsedAt = :lastUsedAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall(
        {
          ':inc': 1,
          ':lastUsedAt': Date.now(), // Store as timestamp
          ':updatedAt': Date.now(), // Store as timestamp
          ':true': 'true',
        },
        {
          removeUndefinedValues: true,
          convertClassInstanceToMap: true,
        }
      ),
      ConditionExpression: 'attribute_exists(id) AND isActive = :true',
    })

    try {
      await dynamoClient.send(command)
      logger.info(`Challenge usage incremented: ${id}`)
    } catch (error) {
      logger.error(
        `Failed to increment usage for challenge ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      throw new Error(`Failed to increment challenge usage: ${error}`)
    }
  }
}

/**
 * Valid ECS CPU and memory combinations.
 * Based on AWS Fargate task definitions.
 */
export const ECS_CONFIG_LIMITS = {
  cpu: {
    256: [512, 1024, 2048], // Memory options for 256 CPU
    512: [1024, 2048, 3072, 4096], // Memory options for 512 CPU
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192], // Memory options for 1024 CPU
    2048: [
      4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336,
      15360, 16384,
    ],
    4096: [
      8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384, 17408, 18432,
      19456, 20480, 21504, 22528, 23552, 24576, 25600, 26624, 27648, 28672,
      29696, 30720,
    ],
  },
  storage: { min: 20, max: 200 }, // GB
} as const

/**
 * AWS Fargate CPU units to vCPU cores mapping.
 * Source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html
 */
export const CPU_UNITS_TO_CORES = {
  256: 0.25, // 0.25 vCPU
  512: 0.5, // 0.5 vCPU
  1024: 1, // 1 vCPU
  2048: 2, // 2 vCPU
  4096: 4, // 4 vCPU
} as const

/**
 * Get the number of vCPU cores for a given CPU unit value.
 */
export function getCpuCores(cpuUnits: number): number {
  return CPU_UNITS_TO_CORES[cpuUnits as keyof typeof CPU_UNITS_TO_CORES] || 0
}

/**
 * Validation utilities for challenge data.
 */
export class ChallengeValidator {
  /**
   * Validate ECS configuration values.
   */
  static validateECSConfig(config: ECSConfiguration): string[] {
    const errors: string[] = []

    // Validate CPU
    const validCpuValues = Object.keys(ECS_CONFIG_LIMITS.cpu).map(Number)
    if (!validCpuValues.includes(config.cpu)) {
      errors.push(
        `Invalid CPU value: ${config.cpu}. Valid values: ${validCpuValues.join(', ')}`
      )
    }

    // Validate memory for given CPU
    if (validCpuValues.includes(config.cpu)) {
      const validMemoryValues =
        ECS_CONFIG_LIMITS.cpu[config.cpu as keyof typeof ECS_CONFIG_LIMITS.cpu]
      if (!(validMemoryValues as readonly number[]).includes(config.memory)) {
        errors.push(
          `Invalid memory value: ${config.memory} for CPU ${config.cpu}. Valid values: ${validMemoryValues.join(', ')}`
        )
      }
    }

    // Validate storage
    if (
      config.storage < ECS_CONFIG_LIMITS.storage.min ||
      config.storage > ECS_CONFIG_LIMITS.storage.max
    ) {
      errors.push(
        `Storage must be between ${ECS_CONFIG_LIMITS.storage.min} and ${ECS_CONFIG_LIMITS.storage.max} GB`
      )
    }

    return errors
  }

  /**
   * Validate challenge creation input.
   */
  static validateCreateInput(input: CreateChallengeInput): string[] {
    const errors: string[] = []

    if (!input.name || input.name.trim().length === 0) {
      errors.push('Challenge name is required')
    }

    if (!input.description || input.description.trim().length === 0) {
      errors.push('Challenge description is required')
    }

    if (!input.createdBy || input.createdBy.trim().length === 0) {
      errors.push('Creator information is required')
    }

    if (!input.files || input.files.length === 0) {
      errors.push('At least one file is required')
    }

    // Validate ECS config
    errors.push(...this.validateECSConfig(input.ecsConfig))

    return errors
  }
}

/**
 * Default challenge service instance.
 */
export const challengeService = new ChallengeService()
