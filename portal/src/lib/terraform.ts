import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

const PROJECT_PREFIX = process.env.PROJECT_PREFIX || 'prequel'
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev'

export interface TerraformExecutionResult {
  success: boolean
  output: string
  error?: string
  fullOutput?: string
  command?: string
}

export interface InterviewInstance {
  id: string
  candidateName: string
  challenge: string
  password: string
  openai_api_key?: string
  accessUrl?: string
  status:
    | 'scheduled'
    | 'initializing'
    | 'configuring'
    | 'active'
    | 'destroying'
    | 'destroyed'
    | 'error'
  createdAt: Date
}

class TerraformManager {
  private readonly isRunningInECS: boolean
  private readonly awsProfile: string
  private readonly awsRegion: string
  private readonly domainName: string
  private readonly terraformStateBucket: string

  constructor() {
    // Determine deployment context and credential strategy
    // Note: We detect ECS vs local deployment context, not prod vs dev environment
    // Any environment (dev/staging/prod) can run either locally or in ECS
    this.isRunningInECS =
      process.env.AWS_EXECUTION_ENV === 'AWS_ECS_FARGATE' ||
      process.env.AWS_EXECUTION_ENV === 'AWS_ECS_EC2'
    this.awsProfile = this.isRunningInECS
      ? ''
      : `AWS_PROFILE=${process.env.AWS_PROFILE}`
    this.awsRegion = process.env.AWS_REGION || 'us-east-1'
    this.domainName = process.env.DOMAIN_NAME || ''
    this.terraformStateBucket = process.env.TERRAFORM_STATE_BUCKET || ''
  }

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
      TF_CLI_ARGS: '-no-color',
      NO_COLOR: '1',
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
        `aws s3 sync "${workspaceDir}" "s3://${PROJECT_PREFIX}-instance/${s3Key}"`,
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
      await execAsync(`aws s3 ls "s3://${PROJECT_PREFIX}-instance/${s3Key}"`, {
        env: process.env as NodeJS.ProcessEnv,
        timeout: 30000,
      })

      // Download workspace from S3
      await execAsync(
        `aws s3 sync "s3://${PROJECT_PREFIX}-instance/${s3Key}" "${workspaceDir}"`,
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
        `aws s3 sync "s3://${PROJECT_PREFIX}-instance/terraform/" "${workspaceDir}"`,
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
interview_id = "${instance.id}"
candidate_name = "${instance.candidateName}"
challenge = "${instance.challenge}"
password = "${instance.password}"
openai_api_key = "${process.env.OPENAI_API_KEY}"
aws_region = "${this.awsRegion}"
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
openai_api_key = "${process.env.OPENAI_API_KEY}"
`.trim()
  }

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
            `⏳ Service not ready yet (${response.status}), waiting... (${Math.round(elapsed / 1000)}s elapsed)\n`
          )
        }
      } catch (error) {
        attempts++
        const elapsed = Date.now() - startTime

        if (error instanceof Error && error.name === 'TimeoutError') {
          streamData(
            `⏳ Service not responding yet, waiting... (${Math.round(elapsed / 1000)}s elapsed)\n`
          )
        } else {
          streamData(
            `⏳ Connection failed, service may still be starting... (${Math.round(elapsed / 1000)}s elapsed)\n`
          )
        }
      }

      // Wait 10 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 10000))
    }

    const elapsed = Date.now() - startTime
    const errorMsg = `Service health check failed after ${Math.round(elapsed / 1000)}s. ECS service may still be installing dependencies.`
    streamData(`❌ ${errorMsg}\n`)
    return { success: false, error: errorMsg }
  }

  async createInterviewStreaming(
    instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>,
    onData?: (data: string) => void
  ): Promise<
    TerraformExecutionResult & {
      accessUrl?: string
      executionLog?: string[]
      healthCheckPassed?: boolean
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
        'terraform init',
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
        'terraform plan -out=tfplan',
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
        'terraform apply -auto-approve tfplan',
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
        'terraform output -json',
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
          }

          // Upload updated workspace to S3 after successful apply
          await this.uploadWorkspaceToS3(instance.id, workspaceDir)

          return {
            success: true,
            output: applyResult.output,
            fullOutput: executionLog.join('\n\n'),
            accessUrl,
            healthCheckPassed,
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
          }
        }
      }

      return { ...applyResult, executionLog, healthCheckPassed: false }
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
        `${this.awsProfile} aws ecs update-service --cluster ${PROJECT_PREFIX}-${ENVIRONMENT} --service ${serviceName} --desired-count 0 --region ${this.awsRegion}`,
        { timeout: 30000 }
      )

      streamData(`Waiting for service tasks to stop...\n`)
      await execAsync(
        `${this.awsProfile} aws ecs wait services-stable --cluster ${PROJECT_PREFIX}-${ENVIRONMENT} --services ${serviceName} --region ${this.awsRegion}`,
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
      `${this.awsProfile} aws ecs delete-service --cluster ${PROJECT_PREFIX}-${ENVIRONMENT} --service interview-${interviewId} --force --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up target group
    streamData(`Cleaning up target group for interview-${interviewId}...\n`)
    await execAsync(
      `${this.awsProfile} aws elbv2 delete-target-group --target-group-arn \$(aws elbv2 describe-target-groups --names interview-${interviewId}-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up dedicated ALB for this interview
    streamData(`Cleaning up dedicated ALB for interview-${interviewId}...\n`)
    const albName = `interview-${interviewId}-alb`.substring(0, 32)
    await execAsync(
      `${this.awsProfile} aws elbv2 delete-load-balancer --load-balancer-arn \$(aws elbv2 describe-load-balancers --names ${albName} --query 'LoadBalancers[0].LoadBalancerArn' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up Route53 record for subdomain
    streamData(
      `Cleaning up Route53 record for ${interviewId}.${this.domainName}...\n`
    )
    await execAsync(
      `${this.awsProfile} aws route53 list-resource-record-sets --hosted-zone-id \$(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${this.domainName}.\`].Id' --output text | cut -d'/' -f3 --region ${this.awsRegion}) --query 'ResourceRecordSets[?Name==\`${interviewId}.${this.domainName}.\`]' --output json --region ${this.awsRegion} | jq -r '.[0] | if . then "{\\"Action\\": \\"DELETE\\", \\"ResourceRecordSet\\": .}" else empty end' | if read change; then aws route53 change-resource-record-sets --hosted-zone-id \$(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${this.domainName}.\`].Id' --output text | cut -d'/' -f3) --change-batch "{\\"Changes\\": [\$change]}" --region ${this.awsRegion}; fi || true`,
      { timeout: 30000 }
    )

    // Clean up security groups for the ALB and ECS
    streamData(`Cleaning up security groups for ALB and ECS...\n`)
    await execAsync(
      `${this.awsProfile} aws ec2 delete-security-group --group-id \$(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-ecs" --query 'SecurityGroups[0].GroupId' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )
    await execAsync(
      `${this.awsProfile} aws ec2 delete-security-group --group-id \$(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-alb" --query 'SecurityGroups[0].GroupId' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 30000 }
    )

    // Clean up SSM parameter
    streamData(`Cleaning up SSM parameter...\n`)
    await execAsync(
      `${this.awsProfile} aws ssm delete-parameter --name /${PROJECT_PREFIX}/interviews/${interviewId}/password --region ${this.awsRegion} || true`,
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
      'terraform init -reconfigure',
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
      'terraform destroy -auto-approve -var-file=terraform.tfvars',
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
      'terraform init -reconfigure',
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
        `S3 workspace preserved at: s3://${PROJECT_PREFIX}-instance/workspaces/${interviewId}/\n`
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
        `aws s3 ls "s3://${PROJECT_PREFIX}-instance/${s3Key}"`,
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
        `aws s3 rm "s3://${PROJECT_PREFIX}-instance/${s3Key}" --recursive`,
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

  async destroyInterviewStreaming(
    interviewId: string,
    onData?: (data: string) => void
  ): Promise<TerraformExecutionResult> {
    const streamData = (data: string) => {
      if (onData) onData(data)
    }

    try {
      streamData(`Starting destroy for interview ${interviewId}...\n`)

      // Step 1: Scale down ECS service
      streamData(`Looking for running tasks for interview ${interviewId}...\n`)
      await this.scaleDownECSService(interviewId, streamData)

      // Step 2: Prepare workspace for destroy
      const { workspaceDir, success: workspaceReady } =
        await this.prepareWorkspaceForDestroy(interviewId, streamData)

      // Step 3: If no workspace found, perform direct cleanup
      if (!workspaceReady) {
        return await this.performDirectResourceCleanup(interviewId, streamData)
      }

      // Step 4: Run terraform destroy
      const destroyResult = await this.runTerraformDestroy(
        interviewId,
        workspaceDir,
        streamData
      )

      // Step 5: Clean up workspace files
      await this.cleanupWorkspaceFiles(
        interviewId,
        workspaceDir,
        destroyResult,
        streamData
      )

      return destroyResult
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
        error: `Health check retry failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        'terraform output -json',
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
          `aws s3 ls s3://${PROJECT_PREFIX}-instance/workspaces/`,
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
            `echo "Workspaces directory for ${PROJECT_PREFIX} interviews" | aws s3 cp - s3://${PROJECT_PREFIX}-instance/workspaces/.directory`,
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
        `aws s3 ls s3://${PROJECT_PREFIX}-instance/workspaces/ --recursive`,
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
