// src/lib/config.ts
import { fromSSO } from "@aws-sdk/credential-providers";
var isRunningInECS = () => {
  return process.env.AWS_EXECUTION_ENV === "AWS_ECS_FARGATE" || process.env.AWS_EXECUTION_ENV === "AWS_ECS_EC2";
};
var aws = {
  /**
   * AWS region for all services
   */
  region: process.env.AWS_REGION || "us-east-1",
  /**
   * AWS profile for local development (SSO)
   */
  profile: process.env.AWS_PROFILE,
  /**
   * Gets AWS credentials configuration for SDK clients
   */
  getCredentials: () => {
    const awsRegion = aws.region;
    const awsProfile = aws.profile;
    if (isRunningInECS()) {
      console.log("[Config] Using ECS IAM task role for credentials");
      return {
        region: awsRegion
        // No credentials config - uses default ECS task role
      };
    } else if (runtime.isBrowser) {
      console.log("[Config] Browser environment - returning minimal config");
      return {
        region: awsRegion
        // No credentials in browser
      };
    } else {
      if (!awsProfile) {
        throw new Error(
          "AWS_PROFILE environment variable is required for local development. Please set AWS_PROFILE in your .env.local file."
        );
      }
      console.log(`[Config] Using AWS SSO profile: ${awsProfile}`);
      return {
        region: awsRegion,
        credentials: fromSSO({
          profile: awsProfile
        })
      };
    }
  },
  /**
   * Gets deployment context
   */
  get deploymentContext() {
    return isRunningInECS() ? "ecs" : "local";
  }
};
var project = {
  /**
   * Project prefix used for AWS resource naming
   */
  prefix: process.env.PROJECT_PREFIX || "prequel",
  /**
   * Environment (dev, staging, prod)
   */
  environment: process.env.ENVIRONMENT || "dev",
  /**
   * Domain name for interviews (interview-id.domain.com)
   */
  domainName: process.env.DOMAIN_NAME || ""
};
var database = {
  /**
   * DynamoDB table name for interviews
   */
  interviewsTable: process.env.INTERVIEWS_TABLE_NAME || `${project.prefix}-${project.environment}-interviews`,
  /**
   * DynamoDB table name for assessments (interviews + take-homes)
   * Falls back to interviews table for backward compatibility
   */
  assessmentsTable: process.env.ASSESSMENTS_TABLE_NAME || process.env.INTERVIEWS_TABLE_NAME || `${project.prefix}-${project.environment}-interviews`,
  /**
   * DynamoDB table name for operations
   */
  operationsTable: process.env.OPERATIONS_TABLE_NAME || `${project.prefix}-${project.environment}-operations`,
  /**
   * DynamoDB table name for challenges
   */
  challengesTable: process.env.CHALLENGES_TABLE_NAME || `${project.prefix}-${project.environment}-challenges`,
  /**
   * DynamoDB table name for API keys
   */
  apikeysTable: process.env.APIKEYS_TABLE_NAME || `${project.prefix}-${project.environment}-apikeys`
};
var storage = {
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
  terraformStateBucket: process.env.TERRAFORM_STATE_BUCKET || `${project.prefix}-${project.environment}-terraform-state`,
  /**
   * S3 bucket for instance templates
   */
  instanceBucket: `${project.prefix}-${project.environment}-instance`
};
var infrastructure = {
  /**
   * ECS cluster name
   */
  ecsCluster: `${project.prefix}-${project.environment}`
};
var auth = {
  /**
   * Whether authentication is enabled (local dev can disable)
   */
  enabled: process.env.ENABLE_AUTH !== "false",
  /**
   * Shared passcode for local development
   */
  passcode: process.env.AUTH_PASSCODE || ""
};
var logging = {
  /**
   * Log level (debug, info, warn, error)
   */
  level: process.env.LOG_LEVEL || "info"
};
var services = {
  /**
   * OpenAI API key for AI assistance in interviews
   */
  openaiAdminKey: process.env.OPENAI_ADMIN_KEY || "",
  openaiProjectId: process.env.OPENAI_PROJECT_ID || ""
};
var runtime = {
  /**
   * Whether running in browser environment
   */
  isBrowser: typeof window !== "undefined",
  /**
   * Whether running in server environment
   */
  isServer: typeof window === "undefined",
  /**
   * Whether running in development mode
   */
  isDevelopment: process.env.NODE_ENV === "development",
  /**
   * Whether running in production mode
   */
  isProduction: process.env.NODE_ENV === "production"
};
var config = {
  aws,
  project,
  database,
  storage,
  infrastructure,
  auth,
  logging,
  services,
  runtime
};
var config_default = config;

export {
  aws,
  project,
  database,
  storage,
  infrastructure,
  auth,
  logging,
  services,
  runtime,
  config,
  config_default
};
//# sourceMappingURL=chunk-BJRZHASW.js.map