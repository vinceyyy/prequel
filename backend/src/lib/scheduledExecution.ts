import { operationManager } from './operations'
import { interviewManager } from './interviews'
import { config } from './config'
import { openaiService } from './openai'
import { generateSecureString } from './idGenerator'
import { schedulerLogger } from './logger'

/**
 * Executes a scheduled interview creation operation.
 *
 * Creates an OpenAI service account (if configured), provisions the interview
 * infrastructure, and records the operation result. Extracted from
 * SchedulerService to keep the scheduler module focused.
 */
export async function executeScheduledCreate(operation: {
  id: string
  interviewId: string
  candidateName: string
  challenge: string
}) {
  await operationManager.updateOperationStatus(operation.id, 'running')
  await operationManager.addOperationLog(
    operation.id,
    `🕐 Scheduled interview creation starting for ${operation.candidateName}`,
  )

  // Create OpenAI service account if configured
  let serviceAccountId: string | undefined
  let openaiApiKey: string | undefined

  if (config.services.openaiProjectId && config.services.openaiAdminKey) {
    await operationManager.addOperationLog(operation.id, '🤖 Creating OpenAI service account...')

    const serviceAccountResult = await openaiService.createServiceAccount(
      config.services.openaiProjectId,
      `interview-${config.project.environment}-interview-${operation.interviewId}-${operation.candidateName}`,
    )

    if (serviceAccountResult.success) {
      serviceAccountId = serviceAccountResult.serviceAccountId
      openaiApiKey = serviceAccountResult.apiKey
      await operationManager.addOperationLog(
        operation.id,
        `✅ OpenAI service account created: ${serviceAccountId}`,
      )
    } else {
      await operationManager.addOperationLog(
        operation.id,
        `❌ OpenAI service account creation failed: ${serviceAccountResult.error}`,
      )
      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`,
      })

      return // Exit early - don't proceed with interview creation
    }
  }

  const instance = {
    id: operation.interviewId,
    candidateName: operation.candidateName,
    challenge: operation.challenge,
    password: generateSecureString(),
    openaiApiKey,
  }

  try {
    // Get operation details to extract scheduling info
    const operationDetails = await operationManager.getOperation(operation.id)

    const result = await interviewManager.createInterviewWithInfrastructure(
      instance,
      (data: string) => {
        const lines = data.split('\n').filter((line) => line.trim())
        lines.forEach((line) => {
          // Note: We can't await here since this is a streaming callback
          // Logs will be added asynchronously without blocking the stream
          operationManager.addOperationLog(operation.id, line).catch(console.error)
        })
      },
      (accessUrl: string) => {
        // Infrastructure ready callback - update operation
        operationManager
          .updateOperationInfrastructureReady(operation.id, accessUrl, instance.password)
          .catch(console.error)
      },
      operationDetails?.scheduledAt,
      operationDetails?.autoDestroyAt,
      operationDetails?.saveFiles,
      serviceAccountId,
    )

    if (result.success) {
      await operationManager.addOperationLog(
        operation.id,
        '✅ Scheduled interview created successfully!',
      )
      await operationManager.addOperationLog(operation.id, `Access URL: ${result.accessUrl}`)

      await operationManager.setOperationResult(operation.id, {
        success: true,
        accessUrl: result.accessUrl,
        password: instance.password,
        fullOutput: result.fullOutput,
        healthCheckPassed: result.healthCheckPassed,
      })
    } else {
      await operationManager.addOperationLog(operation.id, '❌ Scheduled interview creation failed')
      await operationManager.addOperationLog(operation.id, `Error: ${result.error}`)

      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: result.error,
        fullOutput: result.fullOutput,
      })
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    await operationManager.addOperationLog(operation.id, `❌ Error: ${errorMsg}`)
    await operationManager.setOperationResult(operation.id, {
      success: false,
      error: errorMsg,
    })
  }
}

/**
 * Executes a scheduled interview destruction operation.
 *
 * Deletes the associated OpenAI service account (if any), destroys the
 * interview infrastructure, and records the operation result. Extracted from
 * SchedulerService to keep the scheduler module focused.
 */
export async function executeScheduledDestroy(operation: {
  id: string
  interviewId: string
  candidateName?: string
  challenge?: string
  saveFiles?: boolean
}) {
  await operationManager.updateOperationStatus(operation.id, 'running')
  await operationManager.addOperationLog(
    operation.id,
    `🕐 Scheduled interview destruction starting for ${operation.candidateName || operation.interviewId}`,
  )

  try {
    // Fetch interview record to get OpenAI service account ID
    let interview = null
    try {
      interview = await interviewManager.getInterview(operation.interviewId)
    } catch (error) {
      schedulerLogger.debug('Could not fetch interview record for OpenAI cleanup', {
        interviewId: operation.interviewId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Delete OpenAI service account first (before destroying infrastructure)
    if (interview?.openaiServiceAccountId) {
      await operationManager.addOperationLog(operation.id, '🤖 Deleting OpenAI service account...')

      const deleteResult = await openaiService.deleteServiceAccount(
        config.services.openaiProjectId,
        interview?.openaiServiceAccountId,
      )

      if (deleteResult.success) {
        await operationManager.addOperationLog(
          operation.id,
          `✅ OpenAI service account deleted: ${interview?.openaiServiceAccountId}`,
        )
      } else {
        await operationManager.addOperationLog(
          operation.id,
          `⚠️ OpenAI service account deletion failed: ${deleteResult.error}`,
        )
        // Don't fail the entire destruction - continue with infrastructure cleanup
      }
    }

    // Now destroy the infrastructure
    const result = await interviewManager.destroyInterviewWithInfrastructure(
      operation.interviewId,
      (data: string) => {
        const lines = data.split('\n').filter((line) => line.trim())
        lines.forEach((line) => {
          // Note: We can't await here since this is a streaming callback
          // Logs will be added asynchronously without blocking the stream
          operationManager.addOperationLog(operation.id, line).catch(console.error)
        })
      },
      operation.candidateName,
      operation.challenge,
      operation.saveFiles,
    )

    if (result.success) {
      await operationManager.addOperationLog(
        operation.id,
        '✅ Infrastructure destroyed successfully',
      )

      await operationManager.addOperationLog(
        operation.id,
        '✅ Scheduled interview destroyed successfully!',
      )
      await operationManager.setOperationResult(operation.id, {
        success: true,
        historyS3Key: result.historyS3Key,
        fullOutput: result.fullOutput,
      })
    } else {
      await operationManager.addOperationLog(
        operation.id,
        '❌ Scheduled interview destruction failed',
      )
      await operationManager.addOperationLog(operation.id, `Error: ${result.error}`)

      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: result.error,
        fullOutput: result.fullOutput,
      })
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    await operationManager.addOperationLog(operation.id, `❌ Error: ${errorMsg}`)
    await operationManager.setOperationResult(operation.id, {
      success: false,
      error: errorMsg,
    })
  }
}
