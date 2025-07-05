import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

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
  scenario: string
  password: string
  accessUrl?: string
  status: 'creating' | 'active' | 'destroying' | 'destroyed' | 'error'
  createdAt: Date
}

class TerraformManager {
  private terraformDir: string

  constructor() {
    this.terraformDir = path.resolve(process.cwd(), '../infra')
  }

  private async fixProviderPermissions(workspaceDir: string): Promise<void> {
    try {
      await execAsync(
        `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\; 2>/dev/null || true`,
        { timeout: 10000 }
      )
      console.log('[Terraform] Fixed provider permissions')
    } catch (error) {
      console.log(
        '[Terraform] Warning: Could not fix provider permissions:',
        error
      )
    }
  }

  private async execTerraformStreaming(
    command: string,
    cwd: string,
    onData?: (data: string) => void
  ): Promise<TerraformExecutionResult> {
    console.log(`[Terraform] Executing: ${command}`)
    console.log(`[Terraform] Working directory: ${cwd}`)

    // Determine environment and credential strategy
    const isProduction = process.env.NODE_ENV === 'production'
    const awsProfile = process.env.AWS_PROFILE
    const awsRegion = process.env.AWS_REGION || 'your-aws-region'

    console.log(
      `[Terraform] Environment: ${isProduction ? 'production' : 'development'}`
    )
    console.log(`[Terraform] AWS Region: ${awsRegion}`)

    const env: Record<string, string | undefined> = {
      ...process.env,
      AWS_REGION: awsRegion,
      TF_CLI_ARGS: '-no-color',
      NO_COLOR: '1',
    }

    if (isProduction) {
      // Production: Use IAM roles (ECS task role)
      console.log(`[Terraform] Using ECS IAM role for credentials`)
      env.AWS_EC2_METADATA_DISABLED = 'false'
    } else {
      // Development: Use AWS SSO profile
      console.log(`[Terraform] Using AWS SSO profile: ${awsProfile}`)
      env.AWS_PROFILE = awsProfile
      env.AWS_EC2_METADATA_DISABLED = 'true'

      // Check if AWS SSO credentials are available
      if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SESSION_TOKEN) {
        const errorMsg = `AWS SSO credentials not found. Please run: aws sso login --profile ${awsProfile}`
        console.error(`[Terraform] ${errorMsg}`)

        return {
          success: false,
          output: '',
          error: errorMsg,
          command,
          fullOutput: `Command: ${command}\nDirectory: ${cwd}\n\n--- ERROR ---\n${errorMsg}\n\nTo fix this:\n1. aws sso login --profile ${awsProfile}\n2. export AWS_PROFILE=${awsProfile}\n3. Restart the portal`,
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
        if (onData) {
          // Strip ANSI color codes for clean display
          const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')
          onData(cleanOutput)
        }
        console.log(`[Terraform STDOUT]`, output.trim())
      })

      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        stderr += output
        if (onData) {
          // Strip ANSI color codes for clean display
          const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')
          onData(cleanOutput)
        }
        console.log(`[Terraform STDERR]`, output.trim())
      })

      child.on('close', code => {
        const fullOutput = `Command: ${command}\nDirectory: ${cwd}\n\n--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${
          stderr || '(none)'
        }`

        if (code === 0) {
          console.log(`[Terraform] Success`)
          resolve({
            success: true,
            output: stdout,
            error: stderr || undefined,
            fullOutput,
            command,
          })
        } else {
          console.error(`[Terraform] Failed with exit code: ${code}`)
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
        console.error(`[Terraform] Process error:`, error)
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

  private async execTerraform(
    command: string,
    cwd: string
  ): Promise<TerraformExecutionResult> {
    console.log(`[Terraform] Executing: ${command}`)
    console.log(`[Terraform] Working directory: ${cwd}`)

    // Determine environment and credential strategy
    const isProduction = process.env.NODE_ENV === 'production'
    const awsProfile = process.env.AWS_PROFILE
    const awsRegion = process.env.AWS_REGION || 'your-aws-region'

    console.log(
      `[Terraform] Environment: ${isProduction ? 'production' : 'development'}`
    )
    console.log(`[Terraform] AWS Region: ${awsRegion}`)

    const env: Record<string, string | undefined> = {
      ...process.env,
      AWS_REGION: awsRegion,
    }

    if (isProduction) {
      // Production: Use IAM roles (ECS task role)
      console.log(`[Terraform] Using ECS IAM role for credentials`)
      env.AWS_EC2_METADATA_DISABLED = 'false'
    } else {
      // Development: Use AWS SSO profile
      console.log(`[Terraform] Using AWS SSO profile: ${awsProfile}`)
      env.AWS_PROFILE = awsProfile
      env.AWS_EC2_METADATA_DISABLED = 'true'

      // Check if AWS SSO credentials are available
      if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_SESSION_TOKEN) {
        const errorMsg = `AWS SSO credentials not found. Please run: aws sso login --profile ${awsProfile}`
        console.error(`[Terraform] ${errorMsg}`)

        return {
          success: false,
          output: '',
          error: errorMsg,
          command,
          fullOutput: `Command: ${command}\nDirectory: ${cwd}\n\n--- ERROR ---\n${errorMsg}\n\nTo fix this:\n1. aws sso login --profile ${awsProfile}\n2. export AWS_PROFILE=${awsProfile}\n3. Restart the portal`,
        }
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 300000, // 5 minutes
        env: env as NodeJS.ProcessEnv,
      })

      const fullOutput = `Command: ${command}\nDirectory: ${cwd}\n\n--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${
        stderr || '(none)'
      }`

      console.log(`[Terraform] Success:`, stdout)
      if (stderr) {
        console.log(`[Terraform] Warnings:`, stderr)
      }

      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
        fullOutput,
        command,
      }
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string
        stderr?: string
        message?: string
        code?: number
      }

      const fullOutput = `Command: ${command}\nDirectory: ${cwd}\n\n--- ERROR ---\nExit code: ${
        execError.code || 'unknown'
      }\nMessage: ${execError.message || 'Unknown error'}\n\n--- STDOUT ---\n${
        execError.stdout || '(none)'
      }\n\n--- STDERR ---\n${execError.stderr || '(none)'}`

      console.error(`[Terraform] Failed:`, {
        command,
        code: execError.code,
        stdout: execError.stdout,
        stderr: execError.stderr,
        message: execError.message,
      })

      return {
        success: false,
        output: execError.stdout || '',
        error: execError.stderr || execError.message || 'Unknown error',
        fullOutput,
        command,
      }
    }
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
        `aws s3 sync "${workspaceDir}" "s3://prequel-instance/${s3Key}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(`[Terraform] Uploaded workspace to S3: ${s3Key}`)
    } catch (error) {
      console.error(`[Terraform] Failed to upload workspace to S3:`, error)
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
      await execAsync(`aws s3 ls "s3://prequel-instance/${s3Key}"`, {
        env: process.env as NodeJS.ProcessEnv,
        timeout: 30000,
      })

      // Download workspace from S3
      await execAsync(
        `aws s3 sync "s3://prequel-instance/${s3Key}" "${workspaceDir}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(`[Terraform] Downloaded workspace from S3: ${s3Key}`)
      return true
    } catch {
      console.log(`[Terraform] No existing workspace found in S3: ${s3Key}`)
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
        `aws s3 sync "s3://prequel-instance/terraform/" "${workspaceDir}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(
        `[Terraform] Downloaded templates from S3 to: ${workspaceDir}`
      )
    } catch (error) {
      console.error(`[Terraform] Failed to download templates from S3:`, error)
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
      mainTfContent = mainTfContent.replace(
        'INTERVIEW_ID_PLACEHOLDER',
        interviewId
      )
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
scenario = "${instance.scenario}"
password = "${instance.password}"
aws_region = "${process.env.AWS_REGION || 'your-aws-region'}"
`

    const tfvarsPath = path.join(workspaceDir, 'terraform.tfvars')
    await fs.writeFile(tfvarsPath, tfvarsContent.trim())
  }

  async createInterviewStreaming(
    instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>,
    onData?: (data: string) => void
  ): Promise<
    TerraformExecutionResult & { accessUrl?: string; executionLog?: string[] }
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

          // Upload updated workspace to S3 after successful apply
          await this.uploadWorkspaceToS3(instance.id, workspaceDir)

          return {
            success: true,
            output: applyResult.output,
            fullOutput: executionLog.join('\n\n'),
            accessUrl,
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
          }
        }
      }

      return { ...applyResult, executionLog }
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
      }
    }
  }

  async createInterview(
    instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>
  ): Promise<
    TerraformExecutionResult & { accessUrl?: string; executionLog?: string[] }
  > {
    const workspaceDir = await this.createWorkspace(instance.id)
    const executionLog: string[] = []

    try {
      // Create tfvars file
      await this.createTfvarsFile(workspaceDir, instance)
      executionLog.push(`Created workspace: ${workspaceDir}`)

      // Initialize Terraform
      executionLog.push('Initializing Terraform...')
      const initResult = await this.execTerraform(
        'terraform init',
        workspaceDir
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
      const planResult = await this.execTerraform(
        'terraform plan -out=tfplan',
        workspaceDir
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
      const applyResult = await this.execTerraform(
        'terraform apply -auto-approve tfplan',
        workspaceDir
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
      const outputResult = await this.execTerraform(
        'terraform output -json',
        workspaceDir
      )
      executionLog.push(
        `Outputs result: ${outputResult.success ? 'SUCCESS' : 'FAILED'}`
      )

      if (outputResult.success) {
        try {
          const outputs = JSON.parse(outputResult.output)
          const accessUrl = outputs.access_url?.value
          executionLog.push(`Access URL: ${accessUrl || 'Not found'}`)

          return {
            success: true,
            output: applyResult.output,
            fullOutput: executionLog.join('\n\n'),
            accessUrl,
            executionLog,
          }
        } catch {
          executionLog.push('Failed to parse Terraform outputs')
          return {
            success: true,
            output: applyResult.output,
            error: 'Could not parse Terraform outputs',
            executionLog,
          }
        }
      }

      return { ...applyResult, executionLog }
    } catch (error: unknown) {
      executionLog.push(
        `Workspace creation failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
      return {
        success: false,
        output: '',
        error: `Workspace creation failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        executionLog,
      }
    }
  }

  private async deleteWorkspaceFromS3(interviewId: string): Promise<void> {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    const s3Key = `workspaces/${interviewId}/`

    console.log(
      `[Terraform] CRITICAL: Attempting to delete workspace from S3: ${s3Key}`
    )
    console.log(
      `[Terraform] This will permanently delete interview data for: ${interviewId}`
    )

    try {
      // First, check if workspace actually exists to avoid unnecessary deletion attempts
      const listResult = await execAsync(
        `aws s3 ls "s3://prequel-instance/${s3Key}"`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 30000,
        }
      )

      if (!listResult.stdout.trim()) {
        console.log(
          `[Terraform] Workspace ${s3Key} does not exist in S3, skipping deletion`
        )
        return
      }

      console.log(
        `[Terraform] Confirmed workspace exists, proceeding with deletion: ${s3Key}`
      )

      // Delete workspace from S3
      await execAsync(
        `aws s3 rm "s3://prequel-instance/${s3Key}" --recursive`,
        {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 60000,
        }
      )
      console.log(`[Terraform] SUCCESS: Deleted workspace from S3: ${s3Key}`)
    } catch (error) {
      console.error(`[Terraform] Failed to delete workspace from S3:`, error)
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

      // Step 1: Find and stop running ECS tasks for this interview
      streamData(`Looking for running tasks for interview ${interviewId}...\n`)

      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)

      const awsProfile =
        process.env.NODE_ENV === 'production'
          ? ''
          : `AWS_PROFILE=${process.env.AWS_PROFILE}`
      const awsRegion = process.env.AWS_REGION || 'your-aws-region'

      try {
        // Find and update the individual ECS service for this interview
        const serviceName = `interview-${interviewId}`

        // First, try to scale down the service to 0
        streamData(`Scaling down service ${serviceName} to 0...\n`)
        await execAsync(
          `${awsProfile} aws ecs update-service --cluster prequel-dev --service ${serviceName} --desired-count 0 --region ${awsRegion}`,
          { timeout: 30000 }
        )

        // Wait for tasks to stop
        streamData(`Waiting for service tasks to stop...\n`)
        await execAsync(
          `${awsProfile} aws ecs wait services-stable --cluster prequel-dev --services ${serviceName} --region ${awsRegion}`,
          { timeout: 120000 }
        )

        streamData(`Service scaled down successfully\n`)
      } catch (taskError) {
        streamData(`Warning: Could not scale down ECS service: ${taskError}\n`)
        // Continue with cleanup even if service scaling fails
      }

      // Step 2: Try to run terraform destroy on the workspace
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
            `No workspace found in S3, attempting direct resource cleanup...\n`
          )

          // Try to clean up resources directly via AWS CLI
          try {
            // Clean up ECS service
            streamData(`Cleaning up ECS service interview-${interviewId}...\n`)
            await execAsync(
              `${awsProfile} aws ecs delete-service --cluster prequel-dev --service interview-${interviewId} --force --region ${awsRegion} || true`,
              { timeout: 30000 }
            )

            // Clean up target group
            streamData(
              `Cleaning up target group for interview-${interviewId}...\n`
            )
            await execAsync(
              `${awsProfile} aws elbv2 delete-target-group --target-group-arn \$(aws elbv2 describe-target-groups --names interview-${interviewId}-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ${awsRegion}) --region ${awsRegion} || true`,
              { timeout: 30000 }
            )

            // Clean up dedicated ALB for this interview
            streamData(
              `Cleaning up dedicated ALB for interview-${interviewId}...\n`
            )
            const albName = `interview-${interviewId}-alb`.substring(0, 32)
            await execAsync(
              `${awsProfile} aws elbv2 delete-load-balancer --load-balancer-arn \$(aws elbv2 describe-load-balancers --names ${albName} --query 'LoadBalancers[0].LoadBalancerArn' --output text --region ${awsRegion}) --region ${awsRegion} || true`,
              { timeout: 30000 }
            )

            // Clean up Route53 record for subdomain
            streamData(
              `Cleaning up Route53 record for ${interviewId}.your-domain.com...\n`
            )
            await execAsync(
              `${awsProfile} aws route53 list-resource-record-sets --hosted-zone-id \$(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`blend360.app.\`].Id' --output text | cut -d'/' -f3 --region ${awsRegion}) --query 'ResourceRecordSets[?Name==\`${interviewId}.your-domain.com.\`]' --output json --region ${awsRegion} | jq -r '.[0] | if . then "{\\"Action\\": \\"DELETE\\", \\"ResourceRecordSet\\": .}" else empty end' | if read change; then aws route53 change-resource-record-sets --hosted-zone-id \$(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`blend360.app.\`].Id' --output text | cut -d'/' -f3) --change-batch "{\\"Changes\\": [\$change]}" --region ${awsRegion}; fi || true`,
              { timeout: 30000 }
            )

            // Clean up security groups for the ALB and ECS
            streamData(`Cleaning up security groups for ALB and ECS...\n`)
            await execAsync(
              `${awsProfile} aws ec2 delete-security-group --group-id \$(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-ecs" --query 'SecurityGroups[0].GroupId' --output text --region ${awsRegion}) --region ${awsRegion} || true`,
              { timeout: 30000 }
            )
            await execAsync(
              `${awsProfile} aws ec2 delete-security-group --group-id \$(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-alb" --query 'SecurityGroups[0].GroupId' --output text --region ${awsRegion}) --region ${awsRegion} || true`,
              { timeout: 30000 }
            )

            // Clean up SSM parameter
            streamData(`Cleaning up SSM parameter...\n`)
            await execAsync(
              `${awsProfile} aws ssm delete-parameter --name /prequel/interviews/${interviewId}/password --region ${awsRegion} || true`,
              { timeout: 30000 }
            )

            streamData(`Direct resource cleanup completed\n`)
          } catch (directCleanupError) {
            streamData(
              `Warning: Direct cleanup had issues: ${directCleanupError}\n`
            )
          }

          // DO NOT delete S3 workspace during direct cleanup - it may contain important data
          // Only delete S3 workspace after confirmed successful terraform destroy
          streamData(
            `Preserving S3 workspace - manual cleanup required if resources are fully destroyed\n`
          )

          return {
            success: true,
            output: 'Interview cleanup completed using direct resource cleanup',
            fullOutput: 'Resources cleaned up directly via AWS CLI',
          }
        }
        streamData(`Workspace downloaded successfully\n`)
      } else {
        streamData(`Using existing local workspace\n`)
      }

      // Check if terraform.tfvars exists, create if missing
      const tfvarsPath = path.join(workspaceDir, 'terraform.tfvars')
      try {
        await fs.access(tfvarsPath)
        streamData(`Found existing terraform.tfvars file\n`)
      } catch {
        streamData(
          `terraform.tfvars missing, creating minimal version for destroy...\n`
        )
        // Create minimal tfvars file with required variables for destroy
        const minimalTfvarsContent = `
interview_id = "${interviewId}"
candidate_name = "unknown"
scenario = "javascript"
password = "destroy-temp-password"
aws_region = "${process.env.AWS_REGION || 'your-aws-region'}"
`
        await fs.writeFile(tfvarsPath, minimalTfvarsContent.trim())
        streamData(`Created minimal terraform.tfvars for destruction\n`)
      }

      // Step 3: Initialize and run terraform destroy
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
      }

      if (!initResult.success) {
        streamData(`Terraform init failed, attempting direct cleanup...\n`)

        // Try to fix provider permissions first
        try {
          streamData(`Attempting to fix provider permissions...\n`)
          const { exec } = await import('child_process')
          const { promisify } = await import('util')
          const execAsync = promisify(exec)

          await execAsync(
            `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\;`,
            {
              timeout: 30000,
            }
          )
          streamData(`Provider permissions fixed, retrying init...\n`)

          // Retry init after fixing permissions
          const retryInitResult = await this.execTerraformStreaming(
            'terraform init -reconfigure',
            workspaceDir,
            streamData
          )

          if (retryInitResult.success) {
            streamData(`Init retry succeeded, proceeding with destroy...\n`)

            // Ensure terraform.tfvars exists before destroy
            const tfvarsPath = path.join(workspaceDir, 'terraform.tfvars')
            try {
              await fs.access(tfvarsPath)
              streamData(`Found existing terraform.tfvars file\n`)
            } catch {
              streamData(
                `terraform.tfvars missing, creating minimal version for destroy...\n`
              )
              const minimalTfvarsContent = `
interview_id = "${interviewId}"
candidate_name = "unknown"
scenario = "javascript"
password = "destroy-temp-password"
aws_region = "${process.env.AWS_REGION || 'your-aws-region'}"
`
              await fs.writeFile(tfvarsPath, minimalTfvarsContent.trim())
              streamData(`Created minimal terraform.tfvars for destruction\n`)
            }

            // Continue with normal destroy flow
            const destroyResult = await this.execTerraformStreaming(
              'terraform destroy -auto-approve -var-file=terraform.tfvars',
              workspaceDir,
              streamData
            )

            // Clean up local workspace
            streamData(`Cleaning up local workspace...\n`)
            await fs.rm(workspaceDir, { recursive: true, force: true })

            // Only delete S3 workspace if terraform destroy succeeded
            if (destroyResult.success) {
              streamData(
                `Terraform destroy succeeded, deleting workspace from S3...\n`
              )
              await this.deleteWorkspaceFromS3(interviewId)
              streamData(`S3 workspace cleanup completed successfully\n`)
            } else {
              streamData(
                `Terraform destroy failed, preserving S3 workspace for retry\n`
              )
              streamData(
                `S3 workspace preserved at: s3://prequel-instance/workspaces/${interviewId}/\n`
              )
            }

            return destroyResult
          }
        } catch (permError) {
          streamData(`Permission fix failed: ${permError}\n`)
        }

        // If init still fails after permission fix, preserve workspace for manual cleanup
        streamData(
          `Terraform init failed permanently, preserving workspace for manual intervention\n`
        )
        await fs
          .rm(workspaceDir, { recursive: true, force: true })
          .catch(() => {})

        return {
          success: false,
          output: initResult.output,
          error: `Terraform init failed: ${initResult.error}. Workspace preserved for manual cleanup.`,
        }
      }

      streamData(`Starting terraform destroy for interview ${interviewId}...\n`)
      const destroyResult = await this.execTerraformStreaming(
        'terraform destroy -auto-approve -var-file=terraform.tfvars',
        workspaceDir,
        streamData
      )

      // Clean up local workspace (always safe to do)
      streamData(`Cleaning up local workspace...\n`)
      await fs.rm(workspaceDir, { recursive: true, force: true })

      // Only delete S3 workspace if terraform destroy succeeded
      if (destroyResult.success) {
        streamData(
          `Terraform destroy succeeded, deleting workspace from S3...\n`
        )
        await this.deleteWorkspaceFromS3(interviewId)
        streamData(`S3 workspace cleanup completed successfully\n`)
      } else {
        streamData(
          `Terraform destroy failed, preserving S3 workspace for retry\n`
        )
        streamData(
          `S3 workspace preserved at: s3://prequel-instance/workspaces/${interviewId}/\n`
        )
      }

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

  async destroyInterview(
    interviewId: string
  ): Promise<TerraformExecutionResult> {
    // Use the streaming version internally for consistency
    return this.destroyInterviewStreaming(interviewId)
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

      const outputResult = await this.execTerraform(
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

      console.log('[Terraform] Listing active interviews from S3 workspaces...')

      // First check if the workspaces directory exists
      try {
        await execAsync('aws s3 ls s3://prequel-instance/workspaces/', {
          env: process.env as NodeJS.ProcessEnv,
          timeout: 15000,
        })
      } catch {
        console.log(
          '[Terraform] Workspaces directory does not exist in S3, creating it...'
        )

        // Create the workspaces directory by creating a placeholder file
        try {
          await execAsync(
            'echo "Workspaces directory for Prequel interviews" | aws s3 cp - s3://prequel-instance/workspaces/.directory',
            {
              env: process.env as NodeJS.ProcessEnv,
              timeout: 15000,
            }
          )
          console.log('[Terraform] Created workspaces directory in S3')
        } catch (createError) {
          console.error(
            '[Terraform] Failed to create workspaces directory:',
            createError
          )
        }

        // Return empty list since directory was just created
        return []
      }

      // List workspaces from S3
      const { stdout } = await execAsync(
        'aws s3 ls s3://prequel-instance/workspaces/ --recursive',
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
        `[Terraform] Found ${interviewIds.size} active interviews in S3`
      )
      return Array.from(interviewIds)
    } catch (error) {
      console.error('[Terraform] Failed to list workspaces from S3:', error)
      return []
    }
  }
}

export const terraformManager = new TerraformManager()
