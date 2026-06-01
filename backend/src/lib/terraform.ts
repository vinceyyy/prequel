import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { fileExtractionService } from './fileExtraction'
import { challengeService } from './challenges'
import { config } from './config'
import { processTerraformOutput } from './terraformOutput'
import { deleteWorkspaceFromS3, downloadWorkspaceFromS3 } from './terraformWorkspaceS3'
import {
  cleanupWorkspaceFiles,
  performDirectResourceCleanup,
  prepareWorkspaceForDestroy,
  runTerraformDestroy,
  scaleDownECSService,
  type DestroyDeps,
} from './terraformDestroy'
import {
  createInterviewStreaming,
  getMinimalTfvarsContentPlaceholder,
  type CreateDeps,
} from './terraformCreate'
import type { InterviewInstance, TerraformExecutionResult } from './types/terraform'

const execAsync = promisify(exec)

export type { InterviewInstance, TerraformExecutionResult } from './types/terraform'

/**
 * Manages AWS infrastructure for coding interviews using Terraform.
 *
 * This class handles the complete lifecycle of interview infrastructure including:
 * - **Workspace Management**: S3-backed Terraform workspaces for persistence
 * - **AWS Resource Provisioning**: ECS services, ALBs, Route53, security groups
 * - **Health Checking**: Service readiness verification with retry logic
 * - **Credential Management**: Automatic ECS vs local AWS credential handling
 * - **Streaming Output**: Real-time Terraform command output for UX
 *
 * **Architecture Overview:**
 * Each interview gets isolated AWS infrastructure:
 * - Dedicated ECS service running VS Code server
 * - Application Load Balancer with subdomain (interview-id.domain.com)
 * - Route53 DNS record for custom domain access
 * - Security groups for network isolation
 * - S3-backed challenge file deployment
 *
 * **Credential Strategy:**
 * - **Local Development**: Uses AWS SSO profiles (`aws sso login --profile`)
 * - **ECS Deployment**: Uses IAM task roles (automatic)
 * - **Auto-detection**: Detects deployment context via AWS_EXECUTION_ENV
 *
 * **Workspace Persistence:**
 * - Terraform state stored in S3 bucket
 * - Complete workspace files synchronized to S3
 * - Enables infrastructure recovery across container restarts
 *
 * @example
 * ```typescript
 * // Create an interview with real-time output
 * const result = await terraformManager.createInterviewStreaming(
 *   {
 *     id: 'abc12345',
 *     candidateName: 'John Doe',
 *     challenge: 'javascript',
 *     password: 'secure123'
 *   },
 *   (output) => console.log('Terraform:', output),
 *   (accessUrl) => console.log('Infrastructure ready:', accessUrl)
 * )
 *
 * // Destroy interview infrastructure
 * await terraformManager.destroyInterviewStreaming(
 *   'abc12345',
 *   (output) => console.log('Destroy:', output)
 * )
 * ```
 */
class TerraformManager {
  private readonly isRunningInECS: boolean
  private readonly awsProfile: string
  private readonly awsRegion: string
  private readonly domainName: string
  private readonly terraformStateBucket: string

  constructor() {
    // Use centralized configuration system
    this.isRunningInECS = config.aws.deploymentContext === 'ecs'
    this.awsProfile = config.aws.profile || ''
    this.awsRegion = config.aws.region
    this.domainName = config.project.domainName
    this.terraformStateBucket = config.storage.terraformStateBucket
  }

  /**
   * Fixes Terraform provider binary permissions after download.
   *
   * Terraform providers downloaded via `terraform init` may not have execute
   * permissions in containerized environments. This method ensures all provider
   * binaries are executable to prevent runtime errors.
   *
   * @param workspaceDir - Path to the Terraform workspace directory
   */
  private async fixProviderPermissions(workspaceDir: string): Promise<void> {
    try {
      await execAsync(
        `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\; 2>/dev/null || true`,
        { timeout: 10000 },
      )
      console.log('[fixProviderPermissions] Fixed provider permissions')
    } catch (error) {
      console.log('[fixProviderPermissions] Warning: Could not fix provider permissions:', error)
    }
  }

  private async execTerraformStreaming(
    command: string,
    cwd: string,
    onData?: (data: string) => void,
  ): Promise<TerraformExecutionResult> {
    console.log(`[execTerraformStreaming] Executing: ${command}`)
    console.log(`[execTerraformStreaming] Working directory: ${cwd}`)

    console.log(
      `[execTerraformStreaming] Deployment context: ${this.isRunningInECS ? 'ECS' : 'local'}`,
    )
    console.log(`[execTerraformStreaming] AWS Region: ${this.awsRegion}`)

    const env: Record<string, string | undefined> = {
      ...process.env,
      AWS_REGION: this.awsRegion,
      TF_CLI_ARGS: '-no-color',
      NO_COLOR: '1',
      TF_INPUT: 'false',
    }

    if (this.isRunningInECS) {
      // ECS: Use IAM roles (ECS task role)
      console.log(`[execTerraformStreaming] Using ECS IAM role for credentials`)
      env.AWS_EC2_METADATA_DISABLED = 'false'
    } else {
      // Local: Use AWS SSO profile
      console.log(`[execTerraformStreaming] Using AWS SSO profile: ${this.awsProfile}`)
      env.AWS_PROFILE = this.awsProfile
      env.AWS_EC2_METADATA_DISABLED = 'true'

      // Check if AWS credentials are available (works with both SSO and regular credentials)
      try {
        await execAsync(`aws sts get-caller-identity --profile ${this.awsProfile}`, {
          timeout: 10000,
        })
        console.log(
          `[execTerraformStreaming] AWS credentials validated for profile: ${this.awsProfile}`,
        )
      } catch (credentialError: unknown) {
        const errorMsg = `AWS credentials not available or expired. Please run: aws sso login --profile ${this.awsProfile}`
        console.error(`[execTerraformStreaming] ${errorMsg}`)
        console.error(
          `[execTerraformStreaming] Credential check error:`,
          credentialError instanceof Error ? credentialError.message : String(credentialError),
        )

        return {
          success: false,
          output: '',
          error: errorMsg,
          command,
          fullOutput: `Command: ${command}\nDirectory: ${cwd}\n\n--- ERROR ---\n${errorMsg}\n\nCredential check failed: ${
            credentialError instanceof Error ? credentialError.message : String(credentialError)
          }\n\nTo fix this:\n1. aws sso login --profile ${
            this.awsProfile
          }\n2. export AWS_PROFILE=${this.awsProfile}\n3. Restart the portal`,
        }
      }
    }

    return new Promise((resolve) => {
      const args = command.split(' ').slice(1)
      const child = spawn('terraform', args, {
        cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        const output = data.toString()
        stdout += output
        processTerraformOutput(output, onData)
        console.log(`[execTerraformStreaming - Terraform STDOUT]`, output.trim())
      })

      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        stderr += output
        processTerraformOutput(output, onData)
        console.log(`[execTerraformStreaming - Terraform STDERR]`, output.trim())
      })

      child.on('close', (code) => {
        const fullOutput = `Command: ${command}\nDirectory: ${cwd}\n\n--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${
          stderr || '(none)'
        }`

        if (code === 0) {
          console.log(`[execTerraformStreaming] Success`)
          resolve({
            success: true,
            output: stdout,
            error: stderr || undefined,
            fullOutput,
            command,
          })
        } else {
          console.error(`[execTerraformStreaming] Failed with exit code: ${code}`)
          resolve({
            success: false,
            output: stdout,
            error: stderr || `Process exited with code ${code}`,
            fullOutput,
            command,
          })
        }
      })

      child.on('error', (error) => {
        const fullOutput = `Command: ${command}\nDirectory: ${cwd}\n\n--- ERROR ---\n${error.message}`
        console.error(`[execTerraformStreaming] Process error:`, error)
        resolve({
          success: false,
          output: '',
          error: error.message,
          fullOutput,
          command,
        })
      })
    })
  }

  /**
   * Waits for ECS service to become healthy by polling the access URL.
   *
   * This method performs HTTP health checks against the VS Code server to determine
   * when the service is ready for candidate access. It handles the transition from
   * "configuring" to "active" status by verifying service availability.
   *
   * **Health Check Process:**
   * - Polls every 10 seconds with 8-second request timeout
   * - Uses custom User-Agent for identification in logs
   * - Considers 200 OK response as healthy
   * - Streams progress updates for real-time UI feedback
   *
   * **Common Delays:**
   * ECS services may take time to become healthy due to:
   * - Container image download (if not cached)
   * - Python/Node.js dependency installation
   * - VS Code server initialization
   * - Load balancer health check stabilization
   *
   * @param accessUrl - Full URL to the VS Code service to health check
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 5 minutes)
   * @param onData - Optional callback for real-time health check progress
   * @returns Promise with success status and optional error message
   */
  private async waitForServiceHealth(
    accessUrl: string,
    timeoutMs: number = 300000, // 5 minutes
    onData?: (data: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const streamData = (data: string) => {
      if (onData) onData(data)
    }

    const startTime = Date.now()
    const maxAttempts = Math.floor(timeoutMs / 10000) // Check every 10 seconds
    let attempts = 0

    streamData(`Waiting for ECS service to become healthy at ${accessUrl}...\n`)

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(accessUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Prequel-Portal-HealthCheck/1.0',
          },
          signal: AbortSignal.timeout(8000), // 8 second timeout for each request
        })

        if (response.ok) {
          const elapsed = Date.now() - startTime
          streamData(`✅ ECS service is healthy! (took ${Math.round(elapsed / 1000)}s)\n`)
          return { success: true }
        } else {
          attempts++
          const elapsed = Date.now() - startTime
          streamData(
            `⏳ Service not ready yet (${
              response.status
            }), waiting... (${Math.round(elapsed / 1000)}s elapsed)\n`,
          )
        }
      } catch (error) {
        attempts++
        const elapsed = Date.now() - startTime

        if (error instanceof Error && error.name === 'TimeoutError') {
          streamData(
            `⏳ Service not responding yet, waiting... (${Math.round(elapsed / 1000)}s elapsed)\n`,
          )
        } else {
          streamData(
            `⏳ Connection failed, service may still be starting... (${Math.round(
              elapsed / 1000,
            )}s elapsed)\n`,
          )
        }
      }

      // Wait 10 seconds before next attempt
      await new Promise((resolve) => setTimeout(resolve, 10000))
    }

    const elapsed = Date.now() - startTime
    const errorMsg = `Service health check failed after ${Math.round(
      elapsed / 1000,
    )}s. ECS service may still be installing dependencies.`
    streamData(`❌ ${errorMsg}\n`)
    return { success: false, error: errorMsg }
  }

  /**
   * Creates a complete AWS infrastructure for a coding interview with real-time streaming.
   *
   * This is the primary method for provisioning interview infrastructure. It orchestrates
   * the complete workflow from Terraform workspace setup through infrastructure deployment
   * and health checking. The process has distinct phases that are reflected in the UI:
   *
   * **Phases:**
   * 1. **Workspace Setup**: Downloads templates, creates tfvars, initializes Terraform
   * 2. **Infrastructure Provisioning**: Runs terraform plan and apply (status: "initializing")
   * 3. **Service Health Checking**: Waits for ECS service to be ready (status: "configuring")
   * 4. **Ready**: Service passes health checks (status: "active")
   *
   * **AWS Resources Created:**
   * - ECS service with VS Code server container
   * - Application Load Balancer with subdomain routing
   * - Route53 DNS record (interview-id.domain.com)
   * - Security groups for network isolation
   * - SSM parameter for password storage
   *
   * **Callbacks:**
   * - `onData`: Receives real-time Terraform output for streaming to UI
   * - `onInfrastructureReady`: Called when AWS resources are provisioned but before health check
   *
   * @param instance - Interview configuration (ID, candidate, challenge, password)
   * @param onData - Optional callback for real-time Terraform output streaming
   * @param onInfrastructureReady - Optional callback when infrastructure is ready but service may not be healthy
   * @returns Promise with creation result including access URL and health status
   *
   * @example
   * ```typescript
   * const result = await terraformManager.createInterviewStreaming(
   *   {
   *     id: 'abc12345',
   *     candidateName: 'John Doe',
   *     challenge: 'javascript',
   *     password: 'secure123'
   *   },
   *   (output) => {
   *     // Stream real-time Terraform output to UI
   *     console.log('Terraform:', output)
   *   },
   *   (accessUrl) => {
   *     // Infrastructure is ready, updating status to "configuring"
   *     updateStatus('configuring', accessUrl)
   *   }
   * )
   *
   * if (result.success && result.healthCheckPassed) {
   *   // Interview is fully ready for candidate access
   *   console.log('Access URL:', result.accessUrl)
   * }
   * ```
   */
  async createInterviewStreaming(
    instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>,
    onData?: (data: string) => void,
    onInfrastructureReady?: (accessUrl: string) => void,
  ): Promise<
    TerraformExecutionResult & {
      accessUrl?: string
      executionLog?: string[]
      healthCheckPassed?: boolean
      infrastructureReady?: boolean
    }
  > {
    return createInterviewStreaming(instance, this.createDeps(), onData, onInfrastructureReady)
  }

  /**
   * Builds the dependency bundle the create helpers need from this instance,
   * including the bound execTerraformStreaming primitive and waitForServiceHealth.
   */
  private createDeps(): CreateDeps {
    return {
      awsRegion: this.awsRegion,
      domainName: this.domainName,
      terraformStateBucket: this.terraformStateBucket,
      isRunningInECS: this.isRunningInECS,
      awsProfile: this.awsProfile,
      exec: this.execTerraformStreaming.bind(this),
      fixProviderPermissions: this.fixProviderPermissions.bind(this),
      waitForServiceHealth: this.waitForServiceHealth.bind(this),
    }
  }

  /**
   * Builds the dependency bundle the destroy helpers need from this instance,
   * including the bound execTerraformStreaming primitive.
   */
  private destroyDeps(): DestroyDeps {
    return {
      awsRegion: this.awsRegion,
      domainName: this.domainName,
      exec: this.execTerraformStreaming.bind(this),
      fixProviderPermissions: this.fixProviderPermissions.bind(this),
      downloadWorkspaceFromS3,
      deleteWorkspaceFromS3,
      getMinimalTfvarsContentPlaceholder: (interviewId: string) =>
        getMinimalTfvarsContentPlaceholder(interviewId, this.createDeps()),
    }
  }

  /**
   * Destroys interview infrastructure with comprehensive cleanup and real-time streaming.
   *
   * This method performs complete teardown of interview AWS resources using a multi-step
   * approach to handle various failure scenarios gracefully. It prioritizes successful
   * cleanup even when Terraform state is corrupted or missing.
   *
   * **Destruction Process:**
   * 1. **ECS Service Scaling**: Scale down to 0 tasks to stop running containers
   * 2. **Workspace Recovery**: Download workspace from S3 if not available locally
   * 3. **Terraform Destroy**: Run `terraform destroy` to remove all resources
   * 4. **Direct Cleanup**: If Terraform fails, use AWS CLI for manual resource removal
   * 5. **Cleanup**: Remove local workspace and S3 workspace (only on success)
   *
   * **Fallback Strategy:**
   * If Terraform workspace is missing or corrupted, the method falls back to direct
   * AWS CLI commands to clean up known resource patterns. This ensures interviews
   * can be destroyed even when Terraform state is lost.
   *
   * **Resources Cleaned:**
   * - ECS service and tasks
   * - Application Load Balancer and target groups
   * - Route53 DNS records
   * - Security groups (ALB and ECS)
   * - SSM parameters
   * - S3 workspace files (on successful destroy)
   *
   * @param interviewId - The interview ID to destroy infrastructure for
   * @param onData - Optional callback for real-time destruction output streaming
   * @param candidateName - Optional candidate name for file extraction
   * @param challenge - Optional challenge name for file extraction
   * @param saveFiles - Optional flag to save candidate files before destruction
   * @returns Promise with destruction result and any error details
   *
   * @example
   * ```typescript
   * const result = await terraformManager.destroyInterviewStreaming(
   *   'abc12345',
   *   (output) => {
   *     // Stream real-time destruction output to UI
   *     console.log('Destroy:', output)
   *   }
   * )
   *
   * if (result.success) {
   *   console.log('Interview infrastructure destroyed successfully')
   * } else {
   *   console.error('Destruction failed:', result.error)
   *   // Some manual cleanup may be required
   * }
   * ```
   */
  async destroyInterviewStreaming(
    interviewId: string,
    onData?: (data: string) => void,
    candidateName?: string,
    challenge?: string,
    saveFiles?: boolean,
  ): Promise<TerraformExecutionResult & { historyS3Key?: string }> {
    const streamData = (data: string) => {
      if (onData) onData(data)
    }

    try {
      streamData(`Starting destroy for interview ${interviewId}...\n`)

      let historyS3Key: string | undefined

      // Step 1: Extract candidate files if requested
      if (saveFiles && candidateName && challenge) {
        streamData(`Extracting candidate files for ${candidateName}...\n`)
        try {
          // Get challenge name from challenge ID
          let challengeName = 'Unknown Challenge'
          try {
            const challengeData = await challengeService.getChallenge(challenge)
            if (challengeData) {
              challengeName = challengeData.name
            }
          } catch (error) {
            streamData(
              `Warning: Failed to get challenge name for ${challenge}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }\n`,
            )
          }

          const extractionResult = await fileExtractionService.extractAndUploadFiles({
            interviewId,
            candidateName,
            challengeId: challenge,
            challengeName,
          })

          if (extractionResult.success && extractionResult.s3Key) {
            historyS3Key = extractionResult.s3Key
            streamData(`Files saved to S3: ${extractionResult.s3Key}\n`)
            streamData(`Total files: ${extractionResult.totalFiles || 0}\n`)
            streamData(
              `Total size: ${Math.round((extractionResult.totalSizeBytes || 0) / 1024)} KB\n`,
            )
          } else {
            streamData(`File extraction failed: ${extractionResult.error || 'Unknown error'}\n`)
            streamData(`Continuing with interview destruction...\n`)
          }
        } catch (error) {
          streamData(
            `File extraction error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
          )
          streamData(`Continuing with interview destruction...\n`)
        }
      } else if (saveFiles) {
        streamData(`File extraction skipped: missing candidate name or challenge\n`)
      } else {
        streamData(`File extraction skipped: disabled for this interview\n`)
      }

      const deps = this.destroyDeps()

      // Step 2: Scale down ECS service
      streamData(`Looking for running tasks for interview ${interviewId}...\n`)
      await scaleDownECSService(interviewId, streamData, deps)

      // Step 3: Prepare workspace for destroy
      const { workspaceDir, success: workspaceReady } = await prepareWorkspaceForDestroy(
        interviewId,
        streamData,
        deps,
      )

      // Step 4: If no workspace found, perform direct cleanup
      if (!workspaceReady) {
        const result = await performDirectResourceCleanup(interviewId, streamData, deps)
        return { ...result, historyS3Key }
      }

      // Step 5: Run terraform destroy
      const destroyResult = await runTerraformDestroy(interviewId, workspaceDir, streamData, deps)

      // Step 6: Clean up workspace files
      await cleanupWorkspaceFiles(interviewId, workspaceDir, destroyResult, streamData, deps)

      return { ...destroyResult, historyS3Key }
    } catch (error: unknown) {
      const errorMsg = `Destroy failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      streamData(errorMsg + '\n')
      return {
        success: false,
        output: '',
        error: errorMsg,
      }
    }
  }

  /**
   * Retries health check for an existing interview infrastructure.
   *
   * This method is used when interview infrastructure was created successfully
   * but the initial health check failed. It retrieves the access URL from
   * Terraform state and attempts a new health check with shorter timeout.
   *
   * **Use Cases:**
   * - Initial health check failed during creation
   * - Service was temporarily unavailable
   * - Manual retry after dependency installation
   * - Recovery from transient network issues
   *
   * @param interviewId - The interview ID to retry health check for
   * @param onData - Optional callback for real-time health check progress
   * @returns Promise with success status, error message, and access URL
   *
   * @example
   * ```typescript
   * const result = await terraformManager.retryHealthCheck(
   *   'abc12345',
   *   (output) => console.log('Health check:', output)
   * )
   *
   * if (result.success) {
   *   console.log('Service is now healthy:', result.accessUrl)
   * } else {
   *   console.error('Health check still failing:', result.error)
   * }
   * ```
   */
  async retryHealthCheck(
    interviewId: string,
    onData?: (data: string) => void,
  ): Promise<{ success: boolean; error?: string; accessUrl?: string }> {
    const streamData = (data: string) => {
      if (onData) onData(data)
    }

    try {
      // Get the interview status to find the access URL
      const status = await this.getInterviewStatus(interviewId)

      if (!status.success || !status.outputs) {
        return {
          success: false,
          error: 'Could not get interview status for health check retry',
        }
      }

      const outputs = status.outputs as Record<string, { value: string }>
      const accessUrl = outputs.access_url?.value

      if (!accessUrl) {
        return {
          success: false,
          error: 'No access URL found for health check retry',
        }
      }

      streamData(`Retrying health check for interview ${interviewId}...\n`)

      const healthCheck = await this.waitForServiceHealth(accessUrl, 120000, streamData) // 2 minute timeout for retry

      return {
        success: healthCheck.success,
        error: healthCheck.error,
        accessUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: `Health check retry failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      }
    }
  }

  async getInterviewStatus(
    interviewId: string,
  ): Promise<TerraformExecutionResult & { outputs?: Record<string, unknown> }> {
    const workspaceDir = path.join('/tmp', 'interview-workspaces', `workspace-${interviewId}`)

    try {
      // Try to download workspace from S3 if it doesn't exist locally
      const existsLocally = await fs
        .access(workspaceDir)
        .then(() => true)
        .catch(() => false)

      if (!existsLocally) {
        await fs.mkdir(workspaceDir, { recursive: true })
        const downloadedFromS3 = await downloadWorkspaceFromS3(interviewId, workspaceDir)

        if (!downloadedFromS3) {
          return {
            success: false,
            output: '',
            error: `Interview workspace not found: ${interviewId}`,
          }
        }
      }

      const outputResult = await this.execTerraformStreaming('terraform output -json', workspaceDir)

      if (outputResult.success) {
        try {
          const outputs = JSON.parse(outputResult.output)
          return {
            ...outputResult,
            outputs,
          }
        } catch {
          return {
            ...outputResult,
            error: 'Could not parse Terraform outputs',
          }
        }
      }

      return outputResult
    } catch (error: unknown) {
      return {
        success: false,
        output: '',
        error: `Failed to get interview status: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      }
    }
  }

  async listActiveInterviews(): Promise<string[]> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      console.log('[listActiveInterviews] Listing active interviews from S3 workspaces...')

      // First check if the workspaces directory exists
      try {
        await execAsync(`aws s3 ls s3://${config.storage.instanceBucket}/workspaces/`, {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 15000,
        })
      } catch {
        console.log(
          '[listActiveInterviews] Workspaces directory does not exist in S3, creating it...',
        )

        // Create the workspaces directory by creating a placeholder file
        try {
          await execAsync(
            `echo "Workspaces directory for ${config.project.prefix} interviews" | aws s3 cp - s3://${config.storage.instanceBucket}/workspaces/.directory`,
            {
              env: process.env as NodeJS.ProcessEnv,
              timeout: 15000,
            },
          )
          console.log('[listActiveInterviews] Created workspaces directory in S3')
        } catch (createError) {
          console.error(
            '[listActiveInterviews] Failed to create workspaces directory:',
            createError,
          )
        }

        // Return empty list since directory was just created
        return []
      }

      // List workspaces from S3
      const { stdout } = await execAsync(
        `aws s3 ls s3://${config.storage.instanceBucket}/workspaces/ --recursive`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 30000,
        },
      )

      // Extract interview IDs from S3 paths
      const interviewIds = new Set<string>()
      const lines = stdout.split('\n')

      for (const line of lines) {
        const match = line.match(/workspaces\/([^/]+)\//)
        if (match && match[1] && match[1] !== '.directory') {
          interviewIds.add(match[1])
        }
      }

      console.log(`[listActiveInterviews] Found ${interviewIds.size} active interviews in S3`)
      return Array.from(interviewIds)
    } catch (error) {
      console.error('[listActiveInterviews] Failed to list workspaces from S3:', error)
      return []
    }
  }
}

export const terraformManager = new TerraformManager()
