import { exec } from 'child_process'
import { promisify } from 'util'
import { terraformManager } from './terraform'
import { interviewManager } from './interviews'
import { logger } from './logger'
import { config } from './config'

const execAsync = promisify(exec)

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  success: boolean
  error?: string
  summary: {
    workspacesFound: number
    workspacesDestroyed: number
    workspacesSkipped: number
    workspacesErrored: number
    danglingResourcesFound: number
    danglingResourcesCleaned: number
  }
  details: string[]
  workspaceResults: {
    interviewId: string
    status: 'destroyed' | 'skipped' | 'error'
    reason?: string
    error?: string
  }[]
}

/**
 * Options for cleanup operation
 */
export interface CleanupOptions {
  dryRun?: boolean // If true, only report what would be cleaned up
  forceDestroy?: boolean // If true, destroy even if interview exists in DynamoDB
  maxConcurrency?: number // Maximum number of concurrent operations
  timeout?: number // Timeout in seconds for each operation
}

/**
 * Comprehensive cleanup service for AWS resources and workspace files.
 *
 * This service identifies and cleans up dangling resources that may be left
 * behind due to failed operations or corrupted state. It performs:
 *
 * 1. **Workspace Discovery**: Lists all terraform workspaces in S3
 * 2. **State Validation**: Checks which interviews still exist in DynamoDB
 * 3. **Resource Cleanup**: Destroys terraform infrastructure for dangling workspaces
 * 4. **File Cleanup**: Removes workspace files from S3 after successful destruction
 *
 * **Safety Features:**
 * - Dry run mode to preview changes before executing
 * - Concurrent operation limiting to prevent AWS throttling
 * - Skip active interviews unless forced
 * - Comprehensive logging and error reporting
 *
 * **Use Cases:**
 * - Regular maintenance to clean up failed operations
 * - Emergency cleanup after system issues
 * - Cost optimization by removing forgotten resources
 *
 * @example
 * ```typescript
 * const cleanupService = new CleanupService()
 *
 * // Dry run to see what would be cleaned up
 * const preview = await cleanupService.performCleanup({ dryRun: true })
 * console.log(`Would clean up ${preview.summary.workspacesFound} workspaces`)
 *
 * // Actual cleanup
 * const result = await cleanupService.performCleanup({
 *   maxConcurrency: 3,
 *   timeout: 300
 * })
 * console.log(`Cleaned up ${result.summary.workspacesDestroyed} workspaces`)
 * ```
 */
export class CleanupService {
  private readonly isRunningInECS: boolean
  private readonly awsProfile: string

  constructor() {
    this.isRunningInECS = config.aws.deploymentContext === 'ecs'
    this.awsProfile = config.aws.profile || ''
  }

  /**
   * Performs comprehensive cleanup of dangling AWS resources and workspace files.
   *
   * @param options - Cleanup configuration options
   * @returns Promise with detailed cleanup results
   */
  async performCleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
    const {
      dryRun = false,
      forceDestroy = false,
      maxConcurrency = 3,
      timeout = 300,
    } = options

    const result: CleanupResult = {
      success: true,
      summary: {
        workspacesFound: 0,
        workspacesDestroyed: 0,
        workspacesSkipped: 0,
        workspacesErrored: 0,
        danglingResourcesFound: 0,
        danglingResourcesCleaned: 0,
      },
      details: [],
      workspaceResults: [],
    }

    try {
      logger.info('Starting comprehensive cleanup operation', {
        dryRun,
        forceDestroy,
        maxConcurrency,
        timeout,
      })

      result.details.push(`🧹 Starting cleanup operation (dry run: ${dryRun})`)

      // Step 1: Discover all terraform workspaces in S3
      result.details.push(
        '📋 Step 1: Discovering terraform workspaces in S3...'
      )
      const workspaceIds = await this.listAllWorkspaces()
      result.summary.workspacesFound = workspaceIds.length
      result.details.push(`Found ${workspaceIds.length} workspaces in S3`)

      if (workspaceIds.length === 0) {
        result.details.push('✅ No workspaces found - nothing to clean up')
        return result
      }

      // Step 2: Check which interviews still exist in DynamoDB
      result.details.push('🔍 Step 2: Checking interview status in DynamoDB...')
      const existingInterviews = await this.getExistingInterviews(workspaceIds)
      result.details.push(
        `${existingInterviews.size} interviews still exist in DynamoDB`
      )

      // Step 3: Identify dangling workspaces
      const danglingWorkspaces = workspaceIds.filter(
        id => !existingInterviews.has(id)
      )
      const activeWorkspaces = workspaceIds.filter(id =>
        existingInterviews.has(id)
      )

      result.summary.danglingResourcesFound = danglingWorkspaces.length
      result.details.push(
        `${danglingWorkspaces.length} dangling workspaces found`
      )
      result.details.push(
        `${activeWorkspaces.length} workspaces still have active interviews`
      )

      if (danglingWorkspaces.length === 0 && !forceDestroy) {
        result.details.push(
          '✅ No dangling workspaces found - nothing to clean up'
        )
        return result
      }

      // Step 4: Handle active workspaces (only if forced)
      if (activeWorkspaces.length > 0 && forceDestroy) {
        result.details.push(
          `⚠️  Force destroy enabled - will clean up ${activeWorkspaces.length} active workspaces`
        )
        danglingWorkspaces.push(...activeWorkspaces)
      } else if (activeWorkspaces.length > 0) {
        result.details.push(
          `⏭️  Skipping ${activeWorkspaces.length} active workspaces (use forceDestroy to clean these)`
        )
        activeWorkspaces.forEach(id => {
          result.workspaceResults.push({
            interviewId: id,
            status: 'skipped',
            reason: 'Active interview exists in DynamoDB',
          })
          result.summary.workspacesSkipped++
        })
      }

      if (dryRun) {
        result.details.push(
          `🔍 DRY RUN: Would clean up ${danglingWorkspaces.length} workspaces:`
        )
        danglingWorkspaces.forEach(id => {
          result.details.push(`  - ${id}`)
          result.workspaceResults.push({
            interviewId: id,
            status: 'skipped',
            reason: 'Dry run mode',
          })
        })
        return result
      }

      // Step 5: Clean up dangling workspaces with concurrency control
      result.details.push(
        `🚀 Step 5: Cleaning up ${danglingWorkspaces.length} dangling workspaces...`
      )
      await this.cleanupWorkspacesConcurrently(
        danglingWorkspaces,
        maxConcurrency,
        timeout,
        result
      )

      // Step 6: Cleanup verification
      result.details.push('✅ Step 6: Cleanup completed')
      result.details.push(
        `Summary: ${result.summary.workspacesDestroyed} destroyed, ${result.summary.workspacesSkipped} skipped, ${result.summary.workspacesErrored} errors`
      )

      if (result.summary.workspacesErrored > 0) {
        result.success = false
        result.error = `${result.summary.workspacesErrored} workspaces failed to clean up`
      }

      logger.info('Cleanup operation completed', result.summary)
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Cleanup operation failed', { error: errorMsg })
      result.success = false
      result.error = errorMsg
      result.details.push(`❌ Cleanup failed: ${errorMsg}`)
      return result
    }
  }

  /**
   * Lists all terraform workspaces stored in S3.
   */
  private async listAllWorkspaces(): Promise<string[]> {
    try {
      // First check if the bucket and prefix exist
      const checkResult = await execAsync(
        `aws s3api head-bucket --bucket ${config.storage.instanceBucket} 2>/dev/null && echo "exists" || echo "not-exists"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 10000,
        }
      ).catch(() => ({ stdout: 'not-exists', stderr: '' }))

      if (checkResult.stdout.trim() === 'not-exists') {
        logger.info(
          'Instance bucket does not exist - no workspaces to clean up'
        )
        return []
      }

      // List the workspaces
      const { stdout } = await execAsync(
        `aws s3 ls s3://${config.storage.instanceBucket}/workspaces/ --recursive`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 30000,
        }
      )

      // Check if the output is empty (no workspaces)
      if (!stdout || stdout.trim() === '') {
        logger.info('No workspaces found in S3 bucket')
        return []
      }

      // Extract interview IDs from S3 paths
      const workspaceIds = new Set<string>()
      const lines = stdout.split('\n').filter(line => line.trim()) // Filter empty lines

      for (const line of lines) {
        const match = line.match(/workspaces\/([^\/]+)\//)
        if (match && match[1] && match[1] !== '.directory') {
          workspaceIds.add(match[1])
        }
      }

      logger.info(`Found ${workspaceIds.size} workspaces in S3`, {
        workspaceIds: Array.from(workspaceIds),
      })
      return Array.from(workspaceIds)
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message || ''

        // Handle common S3 error cases gracefully
        if (errorMessage.includes('NoSuchBucket')) {
          logger.info(
            'Instance bucket does not exist - no workspaces to clean up'
          )
          return []
        }

        // When the workspaces/ prefix doesn't exist, aws s3 ls returns exit code 1 with no output
        // This is not an error condition - it just means no workspaces exist
        if (
          errorMessage.includes('NoSuchKey') ||
          errorMessage.includes('does not exist') ||
          errorMessage.includes('Command failed: aws s3 ls')
        ) {
          logger.info('No workspaces found in S3 - nothing to clean up')
          return []
        }

        if (
          errorMessage.includes('AccessDenied') ||
          errorMessage.includes('Forbidden')
        ) {
          logger.warn('Access denied to S3 bucket - check AWS permissions', {
            bucket: config.storage.instanceBucket,
          })
          throw new Error(
            `Access denied to S3 bucket: ${config.storage.instanceBucket}. Check AWS permissions.`
          )
        }
      }

      // For any other error, log it but return empty array (no workspaces)
      logger.info('No workspaces found or unable to list S3 contents', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return []
    }
  }

  /**
   * Gets the set of interview IDs that still exist in DynamoDB.
   */
  private async getExistingInterviews(
    workspaceIds: string[]
  ): Promise<Set<string>> {
    const existingInterviews = new Set<string>()

    // Check each workspace ID against DynamoDB
    // Use batch processing to avoid overwhelming DynamoDB
    const batchSize = 25 // DynamoDB batch limit
    for (let i = 0; i < workspaceIds.length; i += batchSize) {
      const batch = workspaceIds.slice(i, i + batchSize)

      const batchPromises = batch.map(async interviewId => {
        try {
          const interview = await interviewManager.getInterview(interviewId)
          if (interview) {
            existingInterviews.add(interviewId)
          }
        } catch (error) {
          // Interview doesn't exist or error accessing it
          logger.debug(`Interview ${interviewId} not found in DynamoDB`, {
            error,
          })
        }
      })

      await Promise.all(batchPromises)

      // Small delay to avoid overwhelming DynamoDB
      if (i + batchSize < workspaceIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    return existingInterviews
  }

  /**
   * Cleans up workspaces with controlled concurrency.
   */
  private async cleanupWorkspacesConcurrently(
    workspaceIds: string[],
    maxConcurrency: number,
    timeoutSeconds: number,
    result: CleanupResult
  ): Promise<void> {
    let activeOperations = 0

    const processWorkspace = async (interviewId: string): Promise<void> => {
      // Wait for available slot
      while (activeOperations >= maxConcurrency) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      activeOperations++

      try {
        result.details.push(`🔥 Destroying workspace: ${interviewId}`)

        const destroyResult = await Promise.race([
          terraformManager.destroyInterviewStreaming(interviewId, output => {
            // Optionally log terraform output for debugging
            logger.debug(`Terraform output for ${interviewId}`, {
              output: output.trim(),
            })
          }),
          // Timeout after specified seconds
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Operation timed out')),
              timeoutSeconds * 1000
            )
          ),
        ])

        if (destroyResult.success) {
          result.workspaceResults.push({
            interviewId,
            status: 'destroyed',
          })
          result.summary.workspacesDestroyed++
          result.summary.danglingResourcesCleaned++
          result.details.push(`✅ Successfully destroyed: ${interviewId}`)
        } else {
          result.workspaceResults.push({
            interviewId,
            status: 'error',
            error: destroyResult.error,
          })
          result.summary.workspacesErrored++
          result.details.push(
            `❌ Failed to destroy: ${interviewId} - ${destroyResult.error}`
          )
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        result.workspaceResults.push({
          interviewId,
          status: 'error',
          error: errorMsg,
        })
        result.summary.workspacesErrored++
        result.details.push(`❌ Error destroying: ${interviewId} - ${errorMsg}`)
      } finally {
        activeOperations--
      }
    }

    // Process all workspaces
    await Promise.all(workspaceIds.map(processWorkspace))
  }

  /**
   * Lists all dangling resources without cleaning them up.
   * Useful for reporting and monitoring.
   */
  async listDanglingResources(): Promise<{
    workspaces: string[]
    existingInterviews: string[]
    danglingWorkspaces: string[]
  }> {
    const workspaces = await this.listAllWorkspaces()
    const existingInterviews = await this.getExistingInterviews(workspaces)
    const danglingWorkspaces = workspaces.filter(
      id => !existingInterviews.has(id)
    )

    return {
      workspaces,
      existingInterviews: Array.from(existingInterviews),
      danglingWorkspaces,
    }
  }
}

export const cleanupService = new CleanupService()
