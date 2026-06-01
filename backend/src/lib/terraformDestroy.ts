import path from 'path'
import fs from 'fs/promises'
import { config } from './config'
import { getAwsCliPrefix } from './terraformOutput'
import type { TerraformExecutionResult } from './types/terraform'

/**
 * Signature of the bound `execTerraformStreaming` primitive used to run
 * terraform commands within the destroy helpers.
 */
type ExecTerraform = (
  command: string,
  cwd: string,
  onData?: (data: string) => void,
) => Promise<TerraformExecutionResult>

/**
 * Dependencies the destroy helpers need from the TerraformManager instance.
 * These are passed in (rather than imported) so the helpers stay decoupled
 * from the manager while preserving identical behavior.
 */
export interface DestroyDeps {
  awsRegion: string
  domainName: string
  exec: ExecTerraform
  fixProviderPermissions: (workspaceDir: string) => Promise<void>
  downloadWorkspaceFromS3: (interviewId: string, workspaceDir: string) => Promise<boolean>
  deleteWorkspaceFromS3: (interviewId: string) => Promise<void>
  getMinimalTfvarsContentPlaceholder: (interviewId: string) => string
}

export async function scaleDownECSService(
  interviewId: string,
  streamData: (data: string) => void,
  deps: DestroyDeps,
): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  try {
    const serviceName = `interview-${interviewId}`

    streamData(`Scaling down service ${serviceName} to 0...\n`)
    await execAsync(
      `${getAwsCliPrefix()}aws ecs update-service --cluster ${
        config.infrastructure.ecsCluster
      } --service ${serviceName} --desired-count 0 --region ${deps.awsRegion}`,
      { timeout: 30000 },
    )

    streamData(`Waiting for service tasks to stop...\n`)
    await execAsync(
      `${getAwsCliPrefix()}aws ecs wait services-stable --cluster ${
        config.infrastructure.ecsCluster
      } --services ${serviceName} --region ${deps.awsRegion}`,
      { timeout: 120000 },
    )

    streamData(`Service scaled down successfully\n`)
  } catch (taskError) {
    streamData(`Warning: Could not scale down ECS service: ${taskError}\n`)
    // Continue with cleanup even if service scaling fails
  }
}

export async function prepareWorkspaceForDestroy(
  interviewId: string,
  streamData: (data: string) => void,
  deps: DestroyDeps,
): Promise<{ workspaceDir: string; success: boolean }> {
  const workspaceDir = path.join('/tmp', 'interview-workspaces', `workspace-${interviewId}`)

  // Try to download workspace from S3 if it doesn't exist locally
  const existsLocally = await fs
    .access(workspaceDir)
    .then(() => true)
    .catch(() => false)

  if (!existsLocally) {
    streamData(`Downloading workspace from S3 for interview ${interviewId}...\n`)
    await fs.mkdir(workspaceDir, { recursive: true })
    const downloadedFromS3 = await deps.downloadWorkspaceFromS3(interviewId, workspaceDir)

    if (!downloadedFromS3) {
      streamData(`No workspace found in S3, will attempt direct resource cleanup...\n`)
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
    streamData(`terraform.tfvars missing, creating minimal version for destroy...\n`)
    await fs.writeFile(tfvarsPath, deps.getMinimalTfvarsContentPlaceholder(interviewId))
    streamData(`Created minimal terraform.tfvars for destruction\n`)
  } else {
    streamData(`Found existing terraform.tfvars file\n`)
  }

  return { workspaceDir, success: true }
}

export async function performDirectResourceCleanup(
  interviewId: string,
  streamData: (data: string) => void,
  deps: DestroyDeps,
): Promise<TerraformExecutionResult> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  streamData(`No workspace found in S3, attempting direct resource cleanup...\n`)

  // Clean up ECS service
  streamData(`Cleaning up ECS service interview-${interviewId}...\n`)
  await execAsync(
    `${getAwsCliPrefix()}aws ecs delete-service --cluster ${
      config.infrastructure.ecsCluster
    } --service interview-${interviewId} --force --region ${deps.awsRegion} || true`,
    { timeout: 30000 },
  )

  // Clean up target group
  streamData(`Cleaning up target group for interview-${interviewId}...\n`)
  await execAsync(
    `${getAwsCliPrefix()}aws elbv2 delete-target-group --target-group-arn $(aws elbv2 describe-target-groups --names interview-${interviewId}-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ${
      deps.awsRegion
    }) --region ${deps.awsRegion} || true`,
    { timeout: 30000 },
  )

  // Clean up dedicated ALB for this interview
  streamData(`Cleaning up dedicated ALB for interview-${interviewId}...\n`)
  const albName = `interview-${interviewId}-alb`.substring(0, 32)
  await execAsync(
    `${getAwsCliPrefix()}aws elbv2 delete-load-balancer --load-balancer-arn $(aws elbv2 describe-load-balancers --names ${albName} --query 'LoadBalancers[0].LoadBalancerArn' --output text --region ${
      deps.awsRegion
    }) --region ${deps.awsRegion} || true`,
    { timeout: 30000 },
  )

  // Clean up Route53 record for subdomain
  streamData(`Cleaning up Route53 record for ${interviewId}.${deps.domainName}...\n`)
  await execAsync(
    `${getAwsCliPrefix()}aws route53 list-resource-record-sets --hosted-zone-id $(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${
      deps.domainName
    }.\`].Id' --output text | cut -d'/' -f3 --region ${
      deps.awsRegion
    }) --query 'ResourceRecordSets[?Name==\`${interviewId}.${
      deps.domainName
    }.\`]' --output json --region ${
      deps.awsRegion
    } | jq -r '.[0] | if . then "{\\"Action\\": \\"DELETE\\", \\"ResourceRecordSet\\": .}" else empty end' | if read change; then aws route53 change-resource-record-sets --hosted-zone-id $(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${
      deps.domainName
    }.\`].Id' --output text | cut -d'/' -f3) --change-batch "{\\"Changes\\": [$change]}" --region ${
      deps.awsRegion
    }; fi || true`,
    { timeout: 30000 },
  )

  // Clean up security groups for the ALB and ECS
  streamData(`Cleaning up security groups for ALB and ECS...\n`)
  await execAsync(
    `${getAwsCliPrefix()}aws ec2 delete-security-group --group-id $(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-ecs" --query 'SecurityGroups[0].GroupId' --output text --region ${
      deps.awsRegion
    }) --region ${deps.awsRegion} || true`,
    { timeout: 30000 },
  )
  await execAsync(
    `${getAwsCliPrefix()}aws ec2 delete-security-group --group-id $(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-alb" --query 'SecurityGroups[0].GroupId' --output text --region ${
      deps.awsRegion
    }) --region ${deps.awsRegion} || true`,
    { timeout: 30000 },
  )

  // Clean up SSM parameter
  streamData(`Cleaning up SSM parameter...\n`)
  await execAsync(
    `${getAwsCliPrefix()}aws ssm delete-parameter --name /${
      config.project.prefix
    }/interviews/${interviewId}/password --region ${deps.awsRegion} || true`,
    { timeout: 30000 },
  )

  streamData(`Direct resource cleanup completed\n`)
  streamData(`Preserving S3 workspace - manual cleanup required if resources are fully destroyed\n`)

  return {
    success: true,
    output: 'Interview cleanup completed using direct resource cleanup',
    fullOutput: 'Resources cleaned up directly via AWS CLI',
  }
}

export async function runTerraformDestroy(
  interviewId: string,
  workspaceDir: string,
  streamData: (data: string) => void,
  deps: DestroyDeps,
): Promise<TerraformExecutionResult> {
  // Initialize Terraform
  streamData(`Initializing Terraform...\n`)
  const initResult = await deps.exec(
    'terraform init -input=false -reconfigure',
    workspaceDir,
    streamData,
  )

  // Fix provider permissions after successful init
  if (initResult.success) {
    await deps.fixProviderPermissions(workspaceDir)
    streamData(`Provider permissions fixed\n`)
  } else {
    // Try to fix provider permissions and retry init
    streamData(`Terraform init failed, attempting permission fix...\n`)

    const permissionFixed = await attemptPermissionFixAndRetryInit(workspaceDir, streamData, deps)

    if (permissionFixed.success) {
      streamData(`Init retry succeeded, proceeding with destroy...\n`)
    } else {
      streamData(
        `Terraform init failed permanently, preserving workspace for manual intervention\n`,
      )
      throw new Error(
        `Terraform init failed: ${initResult.error}. Workspace preserved for manual cleanup.`,
      )
    }
  }

  // Run terraform destroy
  streamData(`Starting terraform destroy for interview ${interviewId}...\n`)
  return await deps.exec(
    'terraform destroy -input=false -auto-approve -var-file=terraform.tfvars',
    workspaceDir,
    streamData,
  )
}

export async function attemptPermissionFixAndRetryInit(
  workspaceDir: string,
  streamData: (data: string) => void,
  deps: DestroyDeps,
): Promise<TerraformExecutionResult> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  streamData(`Attempting to fix provider permissions...\n`)
  await execAsync(
    `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\;`,
    { timeout: 30000 },
  )
  streamData(`Provider permissions fixed, retrying init...\n`)

  // Retry init after fixing permissions
  return await deps.exec('terraform init -input=false -reconfigure', workspaceDir, streamData)
}

export async function cleanupWorkspaceFiles(
  interviewId: string,
  workspaceDir: string,
  destroyResult: TerraformExecutionResult,
  streamData: (data: string) => void,
  deps: DestroyDeps,
): Promise<void> {
  // Clean up local workspace (always safe to do)
  streamData(`Cleaning up local workspace...\n`)
  await fs.rm(workspaceDir, { recursive: true, force: true })

  // Only delete S3 workspace if terraform destroy succeeded
  if (destroyResult.success) {
    streamData(`Terraform destroy succeeded, deleting workspace from S3...\n`)
    await deps.deleteWorkspaceFromS3(interviewId)
    streamData(`S3 workspace cleanup completed successfully\n`)
  } else {
    streamData(`Terraform destroy failed, preserving S3 workspace for retry\n`)
    streamData(
      `S3 workspace preserved at: s3://${config.storage.instanceBucket}/workspaces/${interviewId}/\n`,
    )
  }
}
