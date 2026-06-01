import { config } from './config'

export async function uploadWorkspaceToS3(
  interviewId: string,
  workspaceDir: string,
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
      },
    )
    console.log(`[uploadWorkspaceToS3] Uploaded workspace to S3: ${s3Key}`)
  } catch (error) {
    console.error(`[uploadWorkspaceToS3] Failed to upload workspace to S3:`, error)
    throw error
  }
}

export async function downloadWorkspaceFromS3(
  interviewId: string,
  workspaceDir: string,
): Promise<boolean> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const s3Key = `workspaces/${interviewId}/`

  try {
    // Check if workspace exists in S3
    await execAsync(`aws s3 ls "s3://${config.storage.instanceBucket}/${s3Key}"`, {
      env: process.env as NodeJS.ProcessEnv,
      timeout: 30000,
    })

    // Download workspace from S3
    await execAsync(
      `aws s3 sync "s3://${config.storage.instanceBucket}/${s3Key}" "${workspaceDir}"`,
      {
        env: process.env as NodeJS.ProcessEnv,
        timeout: 60000,
      },
    )
    console.log(`[downloadWorkspaceFromS3] Downloaded workspace from S3: ${s3Key}`)
    return true
  } catch {
    console.log(`[downloadWorkspaceFromS3] No existing workspace found in S3: ${s3Key}`)
    return false
  }
}

export async function downloadTemplatesFromS3(workspaceDir: string): Promise<void> {
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
      },
    )
    console.log(`[downloadTemplatesFromS3] Downloaded templates from S3 to: ${workspaceDir}`)
  } catch (error) {
    console.error(`[downloadTemplatesFromS3] Failed to download templates from S3:`, error)
    throw error
  }
}

export async function deleteWorkspaceFromS3(interviewId: string): Promise<void> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const s3Key = `workspaces/${interviewId}/`

  console.log(`[deleteWorkspaceFromS3] CRITICAL: Attempting to delete workspace from S3: ${s3Key}`)
  console.log(
    `[deleteWorkspaceFromS3] This will permanently delete interview data for: ${interviewId}`,
  )

  try {
    // First, check if workspace actually exists to avoid unnecessary deletion attempts
    const listResult = await execAsync(
      `aws s3 ls "s3://${config.storage.instanceBucket}/${s3Key}"`,
      {
        env: process.env as NodeJS.ProcessEnv,
        timeout: 30000,
      },
    )

    if (!listResult.stdout.trim()) {
      console.log(
        `[deleteWorkspaceFromS3] Workspace ${s3Key} does not exist in S3, skipping deletion`,
      )
      return
    }

    console.log(
      `[deleteWorkspaceFromS3] Confirmed workspace exists, proceeding with deletion: ${s3Key}`,
    )

    // Delete workspace from S3
    await execAsync(`aws s3 rm "s3://${config.storage.instanceBucket}/${s3Key}" --recursive`, {
      env: process.env as NodeJS.ProcessEnv,
      timeout: 60000,
    })
    console.log(`[deleteWorkspaceFromS3] SUCCESS: Deleted workspace from S3: ${s3Key}`)
  } catch (error) {
    console.error(`[deleteWorkspaceFromS3] Failed to delete workspace from S3:`, error)
    // Don't throw - this is cleanup, continue even if S3 cleanup fails
  }
}
