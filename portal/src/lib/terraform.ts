import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { fileExtractionService } from './fileExtraction'
import { challengeService } from './challenges'
import { config } from './config'

const execAsync = promisify(exec)

/**
 * Result of a Terraform command execution.
 *
 * Contains the execution status, output, and any error information
 * from running Terraform commands like init, plan, apply, or destroy.
 */
export interface TerraformExecutionResult {
  success: boolean // Whether the command executed successfully
  output: string // Primary command output (usually stdout)
  error?: string // Error message if command failed
  fullOutput?: string // Complete output including stderr and metadata
  command?: string // The original command that was executed
}

/**
 * Represents a coding interview instance with its infrastructure and metadata.
 *
 * This interface defines the complete structure of an interview including
 * AWS infrastructure details, candidate information, and current status.
 */
export interface InterviewInstance {
  id: string // Unique interview identifier (8-character UUID)
  candidateName: string // Name of the candidate taking the interview
  challenge: string // Challenge name (e.g., 'javascript', 'python')
  password: string // Generated password for VS Code access
  openai_api_key?: string // Optional OpenAI API key for AI assistance
  accessUrl?: string // Full URL to access the VS Code instance
  status:
    | 'scheduled' // Waiting for scheduled start time
    | 'initializing' // Terraform provisioning AWS resources
    | 'configuring' // Infrastructure ready, ECS container booting
    | 'active' // Fully ready for candidate access
    | 'destroying' // Infrastructure being torn down
    | 'destroyed' // Infrastructure completely removed
    | 'error' // Failed state requiring manual intervention
  createdAt: Date // When the interview was created
}

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
   * Gets the AWS CLI prefix for commands.
   * For local development, returns empty string since AWS_PROFILE env var is set.
   * For ECS, returns empty string since IAM roles are used.
   */
  private getAwsCliPrefix(): string {
    return ''
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
        { timeout: 10000 }
      )
      console.log('[fixProviderPermissions] Fixed provider permissions')
    } catch (error) {
      console.log(
        '[fixProviderPermissions] Warning: Could not fix provider permissions:',
        error
      )
    }
  }

  /**
   * Processes and formats Terraform command output for streaming display.
   *
   * Cleans ANSI color codes and prefixes each line with [Terraform] for
   * clear identification in mixed log output. Preserves line structure
   * and handles empty lines appropriately.
   *
   * @param output - Raw Terraform command output
   * @param onData - Optional callback to receive formatted output
   */
  private processTerraformOutput(
    output: string,
    onData?: (data: string) => void
  ): void {
    if (!onData) return

    // Strip ANSI color codes for clean display
    const cleanOutput = output.replaceAll(/\x1b\[[0-9;]*m/g, '')
    // Split into lines and prefix each line with [Terraform]
    const lines = cleanOutput.split('\n')
    lines.forEach((line, index) => {
      // Only send non-empty lines, and preserve the last newline if it exists
      if (line || (index === lines.length - 1 && cleanOutput.endsWith('\n'))) {
        onData(
          '[Terraform] ' +
            line +
            (index < lines.length - 1 || cleanOutput.endsWith('\n') ? '\n' : '')
        )
      }
    })
  }

  private async execTerraformStreaming(
    command: string,
    cwd: string,
    onData?: (data: string) => void
  ): Promise<TerraformExecutionResult> {
    console.log(`[execTerraformStreaming] Executing: ${command}`)
    console.log(`[execTerraformStreaming] Working directory: ${cwd}`)

    console.log(
      `[execTerraformStreaming] Deployment context: ${
        this.isRunningInECS ? 'ECS' : 'local'
      }`
    )
    console.log(`[execTerraformStreaming] AWS Region: ${this.awsRegion}`)

    const env: Record<string, string | undefined> = {
      ...process.env,
      AWS_REGION: this.awsRegion,
      TF_CLI_ARGS: '-no-color -input=false',
      NO_COLOR: '1',
      TF_INPUT: 'false',
    }

    if (this.isRunningInECS) {
      // ECS: Use IAM roles (ECS task role)
      console.log(`[execTerraformStreaming] Using ECS IAM role for credentials`)
      env.AWS_EC2_METADATA_DISABLED = 'false'
    } else {
      // Local: Use AWS SSO profile
      console.log(
        `[execTerraformStreaming] Using AWS SSO profile: ${this.awsProfile}`
      )
      env.AWS_PROFILE = this.awsProfile
      env.AWS_EC2_METADATA_DISABLED = 'true'

      // Check if AWS credentials are available (works with both SSO and regular credentials)
      try {
        await execAsync(
          `aws sts get-caller-identity --profile ${this.awsProfile}`,
          {
            timeout: 10000,
          }
        )
        console.log(
          `[execTerraformStreaming] AWS credentials validated for profile: ${this.awsProfile}`
        )
      } catch (credentialError: unknown) {
        const errorMsg = `AWS credentials not available or expired. Please run: aws sso login --profile ${this.awsProfile}`
        console.error(`[execTerraformStreaming] ${errorMsg}`)
        console.error(
          `[execTerraformStreaming] Credential check error:`,
          credentialError instanceof Error
            ? credentialError.message
            : String(credentialError)
        )

        return {
          success: false,
          output: '',
          error: errorMsg,
          command,
          fullOutput: `Command: ${command}\nDirectory: ${cwd}\n\n--- ERROR ---\n${errorMsg}\n\nCredential check failed: ${
            credentialError instanceof Error
              ? credentialError.message
              : String(credentialError)
          }\n\nTo fix this:\n1. aws sso login --profile ${
            this.awsProfile
          }\n2. export AWS_PROFILE=${this.awsProfile}\n3. Restart the portal`,
        }
      }
    }

    return new Promise(resolve => {
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
        this.processTerraformOutput(output, onData)
        console.log(
          `[execTerraformStreaming - Terraform STDOUT]`,
          output.trim()
        )
      })

      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        stderr += output
        this.processTerraformOutput(output, onData)
        console.log(
          `[execTerraformStreaming - Terraform STDERR]`,
          output.trim()
        )
      })

      child.on('close', code => {
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
          console.error(
            `[execTerraformStreaming] Failed with exit code: ${code}`
          )
          resolve({
            success: false,
            output: stdout,
            error: stderr || `Process exited with code ${code}`,
            fullOutput,
            command,
          })
        }
      })

      child.on('error', error => {
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

  private async uploadWorkspaceToS3(
    interviewId: string,
    workspaceDir: string
  ): Promise<void> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const s3Key = `workspaces/${interviewId}/`

    try {
      // Upload entire workspace directory to S3
      await execAsync(
        `aws s3 sync "${workspaceDir}" "s3://${config.storage.instanceBucket}/${s3Key}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(`[uploadWorkspaceToS3] Uploaded workspace to S3: ${s3Key}`)
    } catch (error) {
      console.error(
        `[uploadWorkspaceToS3] Failed to upload workspace to S3:`,
        error
      )
      throw error
    }
  }

  private async downloadWorkspaceFromS3(
    interviewId: string,
    workspaceDir: string
  ): Promise<boolean> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const s3Key = `workspaces/${interviewId}/`

    try {
      // Check if workspace exists in S3
      await execAsync(
        `aws s3 ls "s3://${config.storage.instanceBucket}/${s3Key}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 30000,
        }
      )

      // Download workspace from S3
      await execAsync(
        `aws s3 sync "s3://${config.storage.instanceBucket}/${s3Key}" "${workspaceDir}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(
        `[downloadWorkspaceFromS3] Downloaded workspace from S3: ${s3Key}`
      )
      return true
    } catch {
      console.log(
        `[downloadWorkspaceFromS3] No existing workspace found in S3: ${s3Key}`
      )
      return false
    }
  }

  private async downloadTemplatesFromS3(workspaceDir: string): Promise<void> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      // Download template files from S3
      await execAsync(
        `aws s3 sync "s3://${config.storage.instanceBucket}/terraform/" "${workspaceDir}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(
        `[downloadTemplatesFromS3] Downloaded templates from S3 to: ${workspaceDir}`
      )
    } catch (error) {
      console.error(
        `[downloadTemplatesFromS3] Failed to download templates from S3:`,
        error
      )
      throw error
    }
  }

  private async createWorkspace(interviewId: string): Promise<string> {
    // Use /tmp for container compatibility
    const workspaceDir = path.join(
      '/tmp',
      'interview-workspaces',
      `workspace-${interviewId}`
    )

    // Create workspace directory
    await fs.mkdir(workspaceDir, { recursive: true })

    // Try to download existing workspace from S3 first
    const existsInS3 = await this.downloadWorkspaceFromS3(
      interviewId,
      workspaceDir
    )

    if (!existsInS3) {
      // Download template files from S3
      await this.downloadTemplatesFromS3(workspaceDir)

      // Replace interview ID placeholder in backend configuration
      const mainTfPath = path.join(workspaceDir, 'main.tf')
      let mainTfContent = await fs.readFile(mainTfPath, 'utf-8')
      mainTfContent = mainTfContent
        .replace('INTERVIEW_ID_PLACEHOLDER', interviewId)
        .replaceAll(
          'TERRAFORM_STATE_BUCKET_PLACEHOLDER',
          this.terraformStateBucket
        )
        .replaceAll('AWS_REGION_PLACEHOLDER', this.awsRegion)
      await fs.writeFile(mainTfPath, mainTfContent)

      // Upload new workspace to S3 for persistence
      await this.uploadWorkspaceToS3(interviewId, workspaceDir)
    }

    return workspaceDir
  }

  private async createTfvarsFile(
    workspaceDir: string,
    instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>
  ): Promise<void> {
    const tfvarsContent = `
aws_region = "${this.awsRegion}"
interview_id = "${instance.id}"
candidate_name = "${instance.candidateName}"
challenge = "${instance.challenge}"
password = "${instance.password}"
openai_project_id = "${config.services.openaiProjectId}"
openai_service_account_name = "${instance.candidateName}"
`.trim()
    console.log(`[createTfvarsFile] tfvarsContent: ${tfvarsContent}`)

    const tfvarsPath = path.join(workspaceDir, 'terraform.tfvars')
    await fs.writeFile(tfvarsPath, tfvarsContent)
  }

  private getMinimalTfvarsContentPlaceholder(interviewId: string): string {
    return `
interview_id = "${interviewId}"
candidate_name = "unknown"
challenge = "javascript"
password = "destroy-temp-password"
aws_region = "${this.awsRegion}"
openai_admin_key = "sk-admin-cleanup-placeholder-admin-key"
openai_api_key = "cleanup-placeholder-api-key"
openai_project_name = "${config.services.openaiProjectId || 'cleanup-project'}"
openai_project_id = "${config.services.openaiProjectId || 'cleanup-project'}"
openai_service_account_name = "cleanup-placeholder-service-account-name"
`.trim()
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
    onData?: (data: string) => void
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
          streamData(
            `✅ ECS service is healthy! (took ${Math.round(elapsed / 1000)}s)\n`
          )
          return { success: true }
        } else {
          attempts++
          const elapsed = Date.now() - startTime
          streamData(
            `⏳ Service not ready yet (${
              response.status
            }), waiting... (${Math.round(elapsed / 1000)}s elapsed)\n`
          )
        }
      } catch (error) {
        attempts++
        const elapsed = Date.now() - startTime

        if (error instanceof Error && error.name === 'TimeoutError') {
          streamData(
            `⏳ Service not responding yet, waiting... (${Math.round(
              elapsed / 1000
            )}s elapsed)\n`
          )
        } else {
          streamData(
            `⏳ Connection failed, service may still be starting... (${Math.round(
              elapsed / 1000
            )}s elapsed)\n`
          )
        }
      }

      // Wait 10 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 10000))
    }

    const elapsed = Date.now() - startTime
    const errorMsg = `Service health check failed after ${Math.round(
      elapsed / 1000
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
    onInfrastructureReady?: (accessUrl: string) => void
  ): Promise<
    TerraformExecutionResult & {
      accessUrl?: string
      executionLog?: string[]
      healthCheckPassed?: boolean
      infrastructureReady?: boolean
    }
  > {
    const workspaceDir = await this.createWorkspace(instance.id)
    const executionLog: string[] = []

    const streamData = (data: string) => {
      if (onData) onData(data)
    }

    try {
      // Create tfvars file
      await this.createTfvarsFile(workspaceDir, instance)
      executionLog.push(`Created workspace: ${workspaceDir}`)
      streamData(`Created workspace: ${workspaceDir}\n`)

      // Initialize Terraform
      executionLog.push('Initializing Terraform...')
      streamData('Initializing Terraform...\n')
      const initResult = await this.execTerraformStreaming(
        'terraform init -input=false',
        workspaceDir,
        streamData
      )
      executionLog.push(
        `Init result: ${initResult.success ? 'SUCCESS' : 'FAILED'}`
      )
      if (initResult.fullOutput) executionLog.push(initResult.fullOutput)

      // Fix provider permissions after successful init
      if (initResult.success) {
        await this.fixProviderPermissions(workspaceDir)
        executionLog.push('Provider permissions fixed')
      }

      if (!initResult.success) {
        return {
          ...initResult,
          error: `Init failed: ${initResult.error}`,
          executionLog,
        }
      }

      // Plan
      executionLog.push('Planning infrastructure changes...')
      streamData('Planning infrastructure changes...\n')
      const planResult = await this.execTerraformStreaming(
        'terraform plan -input=false -out=tfplan',
        workspaceDir,
        streamData
      )
      executionLog.push(
        `Plan result: ${planResult.success ? 'SUCCESS' : 'FAILED'}`
      )
      if (planResult.fullOutput) executionLog.push(planResult.fullOutput)

      if (!planResult.success) {
        return {
          ...planResult,
          error: `Plan failed: ${planResult.error}`,
          executionLog,
        }
      }

      // Apply
      executionLog.push('Applying infrastructure changes...')
      streamData('Applying infrastructure changes...\n')
      const applyResult = await this.execTerraformStreaming(
        'terraform apply -input=false -auto-approve tfplan',
        workspaceDir,
        streamData
      )
      executionLog.push(
        `Apply result: ${applyResult.success ? 'SUCCESS' : 'FAILED'}`
      )
      if (applyResult.fullOutput) executionLog.push(applyResult.fullOutput)

      if (!applyResult.success) {
        return {
          ...applyResult,
          error: `Apply failed: ${applyResult.error}`,
          executionLog,
        }
      }

      // Get outputs
      executionLog.push('Retrieving infrastructure outputs...')
      streamData('Retrieving infrastructure outputs...\n')
      const outputResult = await this.execTerraformStreaming(
        'terraform output -input=false -json',
        workspaceDir,
        streamData
      )
      executionLog.push(
        `Outputs result: ${outputResult.success ? 'SUCCESS' : 'FAILED'}`
      )

      if (outputResult.success) {
        try {
          const outputs = JSON.parse(outputResult.output)
          const accessUrl = outputs.access_url?.value
          executionLog.push(`Access URL: ${accessUrl || 'Not found'}`)
          streamData(`Access URL: ${accessUrl || 'Not found'}\n`)

          // Infrastructure is ready - notify callback
          if (accessUrl && onInfrastructureReady) {
            executionLog.push('✅ Infrastructure provisioning completed!')
            streamData('✅ Infrastructure provisioning completed!\n')

            onInfrastructureReady(accessUrl)
          }

          let healthCheckPassed = false

          if (accessUrl) {
            // Wait for ECS service to become healthy before marking as active
            executionLog.push('Waiting for ECS service to become healthy...')
            streamData('Waiting for ECS service to become healthy...\n')

            const healthCheck = await this.waitForServiceHealth(
              accessUrl,
              300000,
              streamData
            )
            healthCheckPassed = healthCheck.success

            if (healthCheck.success) {
              executionLog.push('✅ ECS service is healthy and ready for use!')
              streamData('✅ ECS service is healthy and ready for use!\n')
            } else {
              executionLog.push(`⚠️ Health check failed: ${healthCheck.error}`)
              streamData(`⚠️ Health check failed: ${healthCheck.error}\n`)
              streamData(
                'Note: Interview infrastructure is created but service may need more time to start.\n'
              )

              // Still continue with success but with warning
              // The interview will be marked as active, but logs will show the health check issue
            }

            // Health check complete - service is ready
          }

          // Upload updated workspace to S3 after successful apply
          await this.uploadWorkspaceToS3(instance.id, workspaceDir)

          return {
            success: true,
            output: applyResult.output,
            fullOutput: executionLog.join('\n\n'),
            accessUrl,
            healthCheckPassed,
            infrastructureReady: !!accessUrl,
            executionLog,
          }
        } catch {
          executionLog.push('Failed to parse Terraform outputs')
          streamData('Failed to parse Terraform outputs\n')
          return {
            success: true,
            output: applyResult.output,
            error: 'Could not parse Terraform outputs',
            executionLog,
            healthCheckPassed: false,
            infrastructureReady: false,
          }
        }
      }

      return {
        ...applyResult,
        executionLog,
        healthCheckPassed: false,
        infrastructureReady: false,
      }
    } catch (error: unknown) {
      const errorMsg = `Workspace creation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
      executionLog.push(errorMsg)
      streamData(errorMsg + '\n')

      return {
        success: false,
        output: '',
        error: errorMsg,
        executionLog,
        healthCheckPassed: false,
        infrastructureReady: false,
      }
    }
  }

  private async scaleDownECSService(
    interviewId: string,
    streamData: (data: string) => void
  ): Promise<void> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      const serviceName = `interview-${interviewId}`

      streamData(`Scaling down service ${serviceName} to 0...\n`)
      await execAsync(
        `${this.getAwsCliPrefix()}aws ecs update-service --cluster ${
          config.infrastructure.ecsCluster
        } --service ${serviceName} --desired-count 0 --region ${
          this.awsRegion
        }`,
        { timeout: 30000 }
      )

      streamData(`Waiting for service tasks to stop...\n`)
      await execAsync(
        `${this.getAwsCliPrefix()}aws ecs wait services-stable --cluster ${
          config.infrastructure.ecsCluster
        } --services ${serviceName} --region ${this.awsRegion}`,
        { timeout: 120000 }
      )

      streamData(`Service scaled down successfully\n`)
    } catch (taskError) {
      streamData(`Warning: Could not scale down ECS service: ${taskError}\n`)
      // Continue with cleanup even if service scaling fails
    }
  }

  private async prepareWorkspaceForDestroy(
    interviewId: string,
    streamData: (data: string) => void
  ): Promise<{ workspaceDir: string; success: boolean }> {
    const workspaceDir = path.join(
      '/tmp',
      'interview-workspaces',
      `workspace-${interviewId}`
    )

    // Try to download workspace from S3 if it doesn't exist locally
    const existsLocally = await fs
      .access(workspaceDir)
      .then(() => true)
      .catch(() => false)

    if (!existsLocally) {
      streamData(
        `Downloading workspace from S3 for interview ${interviewId}...\n`
      )
      await fs.mkdir(workspaceDir, { recursive: true })
      const downloadedFromS3 = await this.downloadWorkspaceFromS3(
        interviewId,
        workspaceDir
      )

      if (!downloadedFromS3) {
        streamData(
          `No workspace found in S3, will attempt direct resource cleanup...\n`
        )
        return { workspaceDir, success: false }
      }
      streamData(`Workspace downloaded successfully\n`)
    } else {
      streamData(`Using existing local workspace\n`)
    }

    // Ensure terraform.tfvars exists
    const tfvarsPath = path.join(workspaceDir, 'terraform.tfvars')
    const tfvarsExists = await fs
      .access(tfvarsPath)
      .then(() => true)
      .catch(() => false)

    if (!tfvarsExists) {
      streamData(
        `terraform.tfvars missing, creating minimal version for destroy...\n`
      )
      await fs.writeFile(
        tfvarsPath,
        this.getMinimalTfvarsContentPlaceholder(interviewId)
      )
      streamData(`Created minimal terraform.tfvars for destruction\n`)
    } else {
      streamData(`Found existing terraform.tfvars file\n`)
    }

    return { workspaceDir, success: true }
  }

  private async performDirectResourceCleanup(
    interviewId: string,
    streamData: (data: string) => void
  ): Promise<TerraformExecutionResult> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    streamData(
      `No workspace found in S3, attempting direct resource cleanup...\n`
    )

    // Clean up ECS service
    streamData(`Cleaning up ECS service interview-${interviewId}...\n`)
    await execAsync(
      `${this.getAwsCliPrefix()}aws ecs delete-service --cluster ${
        config.infrastructure.ecsCluster
      } --service interview-${interviewId} --force --region ${
        this.awsRegion
      } || true`,
      { timeout: 30000 }
    )

    // Clean up target group
    streamData(`Cleaning up target group for interview-${interviewId}...\n`)
    await execAsync(
      `${this.getAwsCliPrefix()}aws elbv2 delete-target-group --target-group-arn \$(aws elbv2 describe-target-groups --names interview-${interviewId}-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ${
        this.awsRegion
      }) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up dedicated ALB for this interview
    streamData(`Cleaning up dedicated ALB for interview-${interviewId}...\n`)
    const albName = `interview-${interviewId}-alb`.substring(0, 32)
    await execAsync(
      `${this.getAwsCliPrefix()}aws elbv2 delete-load-balancer --load-balancer-arn \$(aws elbv2 describe-load-balancers --names ${albName} --query 'LoadBalancers[0].LoadBalancerArn' --output text --region ${
        this.awsRegion
      }) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up Route53 record for subdomain
    streamData(
      `Cleaning up Route53 record for ${interviewId}.${this.domainName}...\n`
    )
    await execAsync(
      `${this.getAwsCliPrefix()}aws route53 list-resource-record-sets --hosted-zone-id \$(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${
        this.domainName
      }.\`].Id' --output text | cut -d'/' -f3 --region ${
        this.awsRegion
      }) --query 'ResourceRecordSets[?Name==\`${interviewId}.${
        this.domainName
      }.\`]' --output json --region ${
        this.awsRegion
      } | jq -r '.[0] | if . then "{\\"Action\\": \\"DELETE\\", \\"ResourceRecordSet\\": .}" else empty end' | if read change; then aws route53 change-resource-record-sets --hosted-zone-id \$(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${
        this.domainName
      }.\`].Id' --output text | cut -d'/' -f3) --change-batch "{\\"Changes\\": [\$change]}" --region ${
        this.awsRegion
      }; fi || true`,
      { timeout: 30000 }
    )

    // Clean up security groups for the ALB and ECS
    streamData(`Cleaning up security groups for ALB and ECS...\n`)
    await execAsync(
      `${this.getAwsCliPrefix()}aws ec2 delete-security-group --group-id \$(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-ecs" --query 'SecurityGroups[0].GroupId' --output text --region ${
        this.awsRegion
      }) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )
    await execAsync(
      `${this.getAwsCliPrefix()}aws ec2 delete-security-group --group-id \$(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-alb" --query 'SecurityGroups[0].GroupId' --output text --region ${
        this.awsRegion
      }) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up SSM parameter
    streamData(`Cleaning up SSM parameter...\n`)
    await execAsync(
      `${this.getAwsCliPrefix()}aws ssm delete-parameter --name /${
        config.project.prefix
      }/interviews/${interviewId}/password --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    streamData(`Direct resource cleanup completed\n`)
    streamData(
      `Preserving S3 workspace - manual cleanup required if resources are fully destroyed\n`
    )

    return {
      success: true,
      output: 'Interview cleanup completed using direct resource cleanup',
      fullOutput: 'Resources cleaned up directly via AWS CLI',
    }
  }

  private async runTerraformDestroy(
    interviewId: string,
    workspaceDir: string,
    streamData: (data: string) => void
  ): Promise<TerraformExecutionResult> {
    // Initialize Terraform
    streamData(`Initializing Terraform...\n`)
    const initResult = await this.execTerraformStreaming(
      'terraform init -input=false -reconfigure',
      workspaceDir,
      streamData
    )

    // Fix provider permissions after successful init
    if (initResult.success) {
      await this.fixProviderPermissions(workspaceDir)
      streamData(`Provider permissions fixed\n`)
    } else {
      // Try to fix provider permissions and retry init
      streamData(`Terraform init failed, attempting permission fix...\n`)

      const permissionFixed = await this.attemptPermissionFixAndRetryInit(
        workspaceDir,
        streamData
      )

      if (permissionFixed.success) {
        streamData(`Init retry succeeded, proceeding with destroy...\n`)
      } else {
        streamData(
          `Terraform init failed permanently, preserving workspace for manual intervention\n`
        )
        throw new Error(
          `Terraform init failed: ${initResult.error}. Workspace preserved for manual cleanup.`
        )
      }
    }

    // Run terraform destroy
    streamData(`Starting terraform destroy for interview ${interviewId}...\n`)
    return await this.execTerraformStreaming(
      'terraform destroy -input=false -auto-approve -var-file=terraform.tfvars',
      workspaceDir,
      streamData
    )
  }

  private async attemptPermissionFixAndRetryInit(
    workspaceDir: string,
    streamData: (data: string) => void
  ): Promise<TerraformExecutionResult> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    streamData(`Attempting to fix provider permissions...\n`)
    await execAsync(
      `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\;`,
      { timeout: 30000 }
    )
    streamData(`Provider permissions fixed, retrying init...\n`)

    // Retry init after fixing permissions
    return await this.execTerraformStreaming(
      'terraform init -input=false -reconfigure',
      workspaceDir,
      streamData
    )
  }

  private async cleanupWorkspaceFiles(
    interviewId: string,
    workspaceDir: string,
    destroyResult: TerraformExecutionResult,
    streamData: (data: string) => void
  ): Promise<void> {
    // Clean up local workspace (always safe to do)
    streamData(`Cleaning up local workspace...\n`)
    await fs.rm(workspaceDir, { recursive: true, force: true })

    // Only delete S3 workspace if terraform destroy succeeded
    if (destroyResult.success) {
      streamData(`Terraform destroy succeeded, deleting workspace from S3...\n`)
      await this.deleteWorkspaceFromS3(interviewId)
      streamData(`S3 workspace cleanup completed successfully\n`)
    } else {
      streamData(
        `Terraform destroy failed, preserving S3 workspace for retry\n`
      )
      streamData(
        `S3 workspace preserved at: s3://${config.storage.instanceBucket}/workspaces/${interviewId}/\n`
      )
    }
  }

  private async deleteWorkspaceFromS3(interviewId: string): Promise<void> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const s3Key = `workspaces/${interviewId}/`

    console.log(
      `[deleteWorkspaceFromS3] CRITICAL: Attempting to delete workspace from S3: ${s3Key}`
    )
    console.log(
      `[deleteWorkspaceFromS3] This will permanently delete interview data for: ${interviewId}`
    )

    try {
      // First, check if workspace actually exists to avoid unnecessary deletion attempts
      const listResult = await execAsync(
        `aws s3 ls "s3://${config.storage.instanceBucket}/${s3Key}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 30000,
        }
      )

      if (!listResult.stdout.trim()) {
        console.log(
          `[deleteWorkspaceFromS3] Workspace ${s3Key} does not exist in S3, skipping deletion`
        )
        return
      }

      console.log(
        `[deleteWorkspaceFromS3] Confirmed workspace exists, proceeding with deletion: ${s3Key}`
      )

      // Delete workspace from S3
      await execAsync(
        `aws s3 rm "s3://${config.storage.instanceBucket}/${s3Key}" --recursive`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(
        `[deleteWorkspaceFromS3] SUCCESS: Deleted workspace from S3: ${s3Key}`
      )
    } catch (error) {
      console.error(
        `[deleteWorkspaceFromS3] Failed to delete workspace from S3:`,
        error
      )
      // Don't throw - this is cleanup, continue even if S3 cleanup fails
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
    saveFiles?: boolean
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
              }\n`
            )
          }

          const extractionResult =
            await fileExtractionService.extractAndUploadFiles({
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
              `Total size: ${Math.round(
                (extractionResult.totalSizeBytes || 0) / 1024
              )} KB\n`
            )
          } else {
            streamData(
              `File extraction failed: ${
                extractionResult.error || 'Unknown error'
              }\n`
            )
            streamData(`Continuing with interview destruction...\n`)
          }
        } catch (error) {
          streamData(
            `File extraction error: ${
              error instanceof Error ? error.message : 'Unknown error'
            }\n`
          )
          streamData(`Continuing with interview destruction...\n`)
        }
      } else if (saveFiles) {
        streamData(
          `File extraction skipped: missing candidate name or challenge\n`
        )
      } else {
        streamData(`File extraction skipped: disabled for this interview\n`)
      }

      // Step 2: Scale down ECS service
      streamData(`Looking for running tasks for interview ${interviewId}...\n`)
      await this.scaleDownECSService(interviewId, streamData)

      // Step 3: Prepare workspace for destroy
      const { workspaceDir, success: workspaceReady } =
        await this.prepareWorkspaceForDestroy(interviewId, streamData)

      // Step 4: If no workspace found, perform direct cleanup
      if (!workspaceReady) {
        const result = await this.performDirectResourceCleanup(
          interviewId,
          streamData
        )
        return { ...result, historyS3Key }
      }

      // Step 5: Run terraform destroy
      const destroyResult = await this.runTerraformDestroy(
        interviewId,
        workspaceDir,
        streamData
      )

      // Step 6: Clean up workspace files
      await this.cleanupWorkspaceFiles(
        interviewId,
        workspaceDir,
        destroyResult,
        streamData
      )

      return { ...destroyResult, historyS3Key }
    } catch (error: unknown) {
      const errorMsg = `Destroy failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
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
    onData?: (data: string) => void
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

      const healthCheck = await this.waitForServiceHealth(
        accessUrl,
        120000,
        streamData
      ) // 2 minute timeout for retry

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
    interviewId: string
  ): Promise<TerraformExecutionResult & { outputs?: Record<string, unknown> }> {
    const workspaceDir = path.join(
      '/tmp',
      'interview-workspaces',
      `workspace-${interviewId}`
    )

    try {
      // Try to download workspace from S3 if it doesn't exist locally
      const existsLocally = await fs
        .access(workspaceDir)
        .then(() => true)
        .catch(() => false)

      if (!existsLocally) {
        await fs.mkdir(workspaceDir, { recursive: true })
        const downloadedFromS3 = await this.downloadWorkspaceFromS3(
          interviewId,
          workspaceDir
        )

        if (!downloadedFromS3) {
          return {
            success: false,
            output: '',
            error: `Interview workspace not found: ${interviewId}`,
          }
        }
      }

      const outputResult = await this.execTerraformStreaming(
        'terraform output -input=false -json',
        workspaceDir
      )

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

      console.log(
        '[listActiveInterviews] Listing active interviews from S3 workspaces...'
      )

      // First check if the workspaces directory exists
      try {
        await execAsync(
          `aws s3 ls s3://${config.storage.instanceBucket}/workspaces/`,
          {
            env: process.env as NodeJS.ProcessEnv,
            timeout: 15000,
          }
        )
      } catch {
        console.log(
          '[listActiveInterviews] Workspaces directory does not exist in S3, creating it...'
        )

        // Create the workspaces directory by creating a placeholder file
        try {
          await execAsync(
            `echo "Workspaces directory for ${config.project.prefix} interviews" | aws s3 cp - s3://${config.storage.instanceBucket}/workspaces/.directory`,
            {
              env: process.env as NodeJS.ProcessEnv,
              timeout: 15000,
            }
          )
          console.log(
            '[listActiveInterviews] Created workspaces directory in S3'
          )
        } catch (createError) {
          console.error(
            '[listActiveInterviews] Failed to create workspaces directory:',
            createError
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
        }
      )

      // Extract interview IDs from S3 paths
      const interviewIds = new Set<string>()
      const lines = stdout.split('\n')

      for (const line of lines) {
        const match = line.match(/workspaces\/([^\/]+)\//)
        if (match && match[1] && match[1] !== '.directory') {
          interviewIds.add(match[1])
        }
      }

      console.log(
        `[listActiveInterviews] Found ${interviewIds.size} active interviews in S3`
      )
      return Array.from(interviewIds)
    } catch (error) {
      console.error(
        '[listActiveInterviews] Failed to list workspaces from S3:',
        error
      )
      return []
    }
  }
}

export const terraformManager = new TerraformManager()
