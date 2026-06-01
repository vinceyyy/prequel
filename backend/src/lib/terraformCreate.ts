import path from 'path'
import fs from 'fs/promises'
import { config } from './config'
import {
  downloadTemplatesFromS3,
  downloadWorkspaceFromS3,
  uploadWorkspaceToS3,
} from './terraformWorkspaceS3'
import type { InterviewInstance, TerraformExecutionResult } from './types/terraform'

/**
 * Signature of the bound `execTerraformStreaming` primitive used to run
 * terraform commands within the create helpers.
 */
type ExecTerraform = (
  command: string,
  cwd: string,
  onData?: (data: string) => void,
) => Promise<TerraformExecutionResult>

/**
 * Dependencies the create helpers need from the TerraformManager instance.
 * These are passed in (rather than imported) so the helpers stay decoupled
 * from the manager while preserving identical behavior.
 */
export interface CreateDeps {
  awsRegion: string
  domainName: string
  terraformStateBucket: string
  isRunningInECS: boolean
  awsProfile: string
  exec: ExecTerraform
  fixProviderPermissions: (workspaceDir: string) => Promise<void>
  waitForServiceHealth: (
    accessUrl: string,
    timeoutMs?: number,
    onData?: (data: string) => void,
  ) => Promise<{ success: boolean; error?: string }>
}

export async function createWorkspace(interviewId: string, deps: CreateDeps): Promise<string> {
  // Use /tmp for container compatibility
  const workspaceDir = path.join('/tmp', 'interview-workspaces', `workspace-${interviewId}`)

  // Create workspace directory
  await fs.mkdir(workspaceDir, { recursive: true })

  // Try to download existing workspace from S3 first
  const existsInS3 = await downloadWorkspaceFromS3(interviewId, workspaceDir)

  if (!existsInS3) {
    // Download template files from S3
    await downloadTemplatesFromS3(workspaceDir)

    // Replace interview ID placeholder in backend configuration
    const mainTfPath = path.join(workspaceDir, 'main.tf')
    let mainTfContent = await fs.readFile(mainTfPath, 'utf-8')
    mainTfContent = mainTfContent
      .replace('INTERVIEW_ID_PLACEHOLDER', interviewId)
      .replaceAll('TERRAFORM_STATE_BUCKET_PLACEHOLDER', deps.terraformStateBucket)
      .replaceAll('AWS_REGION_PLACEHOLDER', deps.awsRegion)
      .replaceAll('ENVIRONMENT_PLACEHOLDER', config.project.environment)
    await fs.writeFile(mainTfPath, mainTfContent)

    // Upload new workspace to S3 for persistence
    await uploadWorkspaceToS3(interviewId, workspaceDir)
  }

  return workspaceDir
}

export async function createTfvarsFile(
  workspaceDir: string,
  instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>,
  deps: CreateDeps,
): Promise<void> {
  const tfvarsContent = `
aws_region = "${deps.awsRegion}"
interview_id = "${instance.id}"
candidate_name = "${instance.candidateName}"
challenge = "${instance.challenge}"
password = "${instance.password}"
welcome_text = "Welcome, ${instance.candidateName}!"
openai_api_key = "${instance.openaiApiKey}"
`.trim()
  console.log(`[createTfvarsFile] tfvarsContent: ${tfvarsContent}`)

  const tfvarsPath = path.join(workspaceDir, 'terraform.tfvars')
  await fs.writeFile(tfvarsPath, tfvarsContent)
}

export function getMinimalTfvarsContentPlaceholder(interviewId: string, deps: CreateDeps): string {
  return `
interview_id = "${interviewId}"
candidate_name = "unknown"
challenge = "javascript"
password = "destroy-temp-password"
aws_region = "${deps.awsRegion}"
openai_admin_key = "sk-admin-cleanup-placeholder-admin-key"
openai_api_key = "cleanup-placeholder-api-key"
openai_project_name = "${config.services.openaiProjectId || 'cleanup-project'}"
openai_project_id = "${config.services.openaiProjectId || 'cleanup-project'}"
openai_service_account_name = "cleanup-placeholder-service-account-name"
`.trim()
}

/**
 * Creates a complete AWS infrastructure for a coding interview with real-time streaming.
 *
 * See `TerraformManager.createInterviewStreaming` for full documentation. This is the
 * extracted orchestration body; the manager method builds the `CreateDeps` bundle and
 * delegates here.
 */
export async function createInterviewStreaming(
  instance: Omit<InterviewInstance, 'accessUrl' | 'status' | 'createdAt'>,
  deps: CreateDeps,
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
  const workspaceDir = await createWorkspace(instance.id, deps)
  const executionLog: string[] = []

  const streamData = (data: string) => {
    if (onData) onData(data)
  }

  try {
    // Create tfvars file
    await createTfvarsFile(workspaceDir, instance, deps)
    executionLog.push(`Created workspace: ${workspaceDir}`)
    streamData(`Created workspace: ${workspaceDir}\n`)

    // Initialize Terraform
    executionLog.push('Initializing Terraform...')
    streamData('Initializing Terraform...\n')
    const initResult = await deps.exec('terraform init -input=false', workspaceDir, streamData)
    executionLog.push(`Init result: ${initResult.success ? 'SUCCESS' : 'FAILED'}`)
    if (initResult.fullOutput) executionLog.push(initResult.fullOutput)

    // Fix provider permissions after successful init
    if (initResult.success) {
      await deps.fixProviderPermissions(workspaceDir)
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
    const planResult = await deps.exec(
      'terraform plan -input=false -out=tfplan',
      workspaceDir,
      streamData,
    )
    executionLog.push(`Plan result: ${planResult.success ? 'SUCCESS' : 'FAILED'}`)
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
    const applyResult = await deps.exec(
      'terraform apply -input=false -auto-approve tfplan',
      workspaceDir,
      streamData,
    )
    executionLog.push(`Apply result: ${applyResult.success ? 'SUCCESS' : 'FAILED'}`)
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
    const outputResult = await deps.exec('terraform output -json', workspaceDir, streamData)
    executionLog.push(`Outputs result: ${outputResult.success ? 'SUCCESS' : 'FAILED'}`)

    if (outputResult.success) {
      try {
        // Log raw output for debugging
        console.log('[createInterview] Raw terraform output length:', outputResult.output.length)
        console.log(
          '[createInterview] Raw terraform output (first 500 chars):',
          outputResult.output.substring(0, 500),
        )

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

          const healthCheck = await deps.waitForServiceHealth(accessUrl, 300000, streamData)
          healthCheckPassed = healthCheck.success

          if (healthCheck.success) {
            executionLog.push('✅ ECS service is healthy and ready for use!')
            streamData('✅ ECS service is healthy and ready for use!\n')
          } else {
            executionLog.push(`⚠️ Health check failed: ${healthCheck.error}`)
            streamData(`⚠️ Health check failed: ${healthCheck.error}\n`)
            streamData(
              'Note: Interview infrastructure is created but service may need more time to start.\n',
            )

            // Still continue with success but with warning
            // The interview will be marked as active, but logs will show the health check issue
          }

          // Health check complete - service is ready
        }

        // Upload updated workspace to S3 after successful apply
        try {
          await uploadWorkspaceToS3(instance.id, workspaceDir)
          executionLog.push('✅ Workspace uploaded to S3 successfully')
        } catch (s3Error) {
          const s3ErrorMsg = s3Error instanceof Error ? s3Error.message : 'Unknown error'
          executionLog.push(`⚠️ Failed to upload workspace to S3: ${s3ErrorMsg}`)
          streamData(`⚠️ Failed to upload workspace to S3: ${s3ErrorMsg}\n`)
          // Continue anyway - infrastructure is created and working
        }

        return {
          success: true,
          output: applyResult.output,
          fullOutput: executionLog.join('\n\n'),
          accessUrl,
          healthCheckPassed,
          infrastructureReady: !!accessUrl,
          executionLog,
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown'
        executionLog.push(`Failed to parse Terraform outputs: ${errorMsg}`)
        executionLog.push(`Raw output (first 500 chars): ${outputResult.output.substring(0, 500)}`)
        streamData(`Failed to parse Terraform outputs: ${errorMsg}\n`)

        // Try to extract access_url using regex as fallback
        let accessUrl: string | undefined
        const urlMatch = outputResult.output.match(/"access_url":\s*{\s*"value":\s*"([^"]+)"/)
        if (urlMatch) {
          accessUrl = urlMatch[1]
          executionLog.push(`Extracted URL via regex: ${accessUrl}`)
          streamData(`Extracted URL via regex: ${accessUrl}\n`)
        }

        return {
          success: true,
          output: applyResult.output,
          error: 'Could not parse Terraform outputs',
          executionLog,
          healthCheckPassed: false,
          infrastructureReady: false,
          accessUrl, // Include extracted URL even on parse failure
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
