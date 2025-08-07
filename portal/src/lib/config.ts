import { fromSSO } from '@aws-sdk/credential-providers'

/**
 * Centralized configuration for the Prequel Portal application.
 *
 * This module provides type-safe access to all environment variables and
 * configuration values used throughout the application, with proper defaults
 * and validation for different deployment contexts.
 */

/**
 * Detects if running in ECS environment
 */
const isRunningInECS = (): boolean => {
  return (
    process.env.AWS_EXECUTION_ENV === 'AWS_ECS_FARGATE' ||
    process.env.AWS_EXECUTION_ENV === 'AWS_ECS_EC2'
  )
}

/**
 * Detects if running during build time (Next.js static generation)
 */
const isRunningDuringBuild = (): boolean => {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    (process.env.NODE_ENV === 'production' &&
      !process.env.AWS_EXECUTION_ENV &&
      !process.env.AWS_PROFILE)
  )
}

/**
 * AWS Configuration
 */
export const aws = {
  /**
   * AWS region for all services
   */
  region: process.env.AWS_REGION || 'us-east-1',

  /**
   * AWS profile for local development (SSO)
   */
  profile: process.env.AWS_PROFILE,

  /**
   * Gets AWS credentials configuration for SDK clients
   */
  getCredentials: () => {
    const awsRegion = aws.region
    const awsProfile = aws.profile

    if (isRunningDuringBuild()) {
      // Build time: Return minimal config for static generation
      console.log('[Config] Build time detected - using minimal AWS config')
      return {
        region: awsRegion,
        // No credentials needed during build
      }
    } else if (isRunningInECS()) {
      // ECS: Use IAM task roles (default behavior)
      console.log('[Config] Using ECS IAM task role for credentials')
      return {
        region: awsRegion,
        // No credentials config - uses default ECS task role
      }
    } else {
      // Local: Use AWS SSO profile
      if (!awsProfile) {
        throw new Error(
          'AWS_PROFILE environment variable is required for local development. ' +
            'Please set AWS_PROFILE in your .env.local file.'
        )
      }

      console.log(`[Config] Using AWS SSO profile: ${awsProfile}`)
      return {
        region: awsRegion,
        credentials: fromSSO({
          profile: awsProfile,
        }),
      }
    }
  },

  /**
   * Gets deployment context
   */
  get deploymentContext(): 'ecs' | 'local' {
    return isRunningInECS() ? 'ecs' : 'local'
  },
}

/**
 * Project Configuration
 */
export const project = {
  /**
   * Project prefix used for AWS resource naming
   */
  prefix: process.env.PROJECT_PREFIX || 'prequel',

  /**
   * Environment (dev, staging, prod)
   */
  environment: process.env.ENVIRONMENT || 'dev',

  /**
   * Domain name for interviews (interview-id.domain.com)
   */
  domainName: process.env.DOMAIN_NAME || '',
}

/**
 * Database Configuration (DynamoDB)
 */
export const database = {
  /**
   * DynamoDB table name for interviews
   */
  interviewsTable:
    process.env.INTERVIEWS_TABLE_NAME ||
    `${project.prefix}-${project.environment}-interviews`,

  /**
   * DynamoDB table name for operations
   */
  operationsTable:
    process.env.OPERATIONS_TABLE_NAME ||
    `${project.prefix}-${project.environment}-operations`,
}

/**
 * Storage Configuration (S3)
 */
export const storage = {
  /**
   * S3 bucket for challenge files
   */
  challengeBucket: `${project.prefix}-${project.environment}-challenge`,

  /**
   * S3 bucket for interview history/saved files
   */
  historyBucket: `${project.prefix}-${project.environment}-history`,

  /**
   * S3 bucket for Terraform state
   */
  terraformStateBucket:
    process.env.TERRAFORM_STATE_BUCKET ||
    `${project.prefix}-${project.environment}-terraform-state`,

  /**
   * S3 bucket for instance templates
   */
  instanceBucket: `${project.prefix}-${project.environment}-instance`,
}

/**
 * Infrastructure Configuration (ECS)
 */
export const infrastructure = {
  /**
   * ECS cluster name
   */
  ecsCluster: `${project.prefix}-${project.environment}`,
}

/**
 * Authentication Configuration
 */
export const auth = {
  /**
   * Whether authentication is enabled (local dev can disable)
   */
  enabled: process.env.ENABLE_AUTH !== 'false',

  /**
   * Shared passcode for local development
   */
  passcode: process.env.AUTH_PASSCODE || '',
}

/**
 * Logging Configuration
 */
export const logging = {
  /**
   * Log level (debug, info, warn, error)
   */
  level: (process.env.LOG_LEVEL || 'info') as
    | 'debug'
    | 'info'
    | 'warn'
    | 'error',
}

/**
 * External Services Configuration
 */
export const services = {
  /**
   * OpenAI API key for AI assistance in interviews
   */
  openaiApiKey: process.env.OPENAI_API_KEY || '',
}

/**
 * Runtime Configuration
 */
export const runtime = {
  /**
   * Whether running in browser environment
   */
  isBrowser: typeof window !== 'undefined',

  /**
   * Whether running in server environment
   */
  isServer: typeof window === 'undefined',

  /**
   * Whether running in development mode
   */
  isDevelopment: process.env.NODE_ENV === 'development',

  /**
   * Whether running in production mode
   */
  isProduction: process.env.NODE_ENV === 'production',
}

/**
 * Complete configuration object
 */
export const config = {
  aws,
  project,
  database,
  storage,
  infrastructure,
  auth,
  logging,
  services,
  runtime,
} as const

/**
 * Type for the complete configuration
 */
export type Config = typeof config

/**
 * Default export for convenience
 */
export default config
