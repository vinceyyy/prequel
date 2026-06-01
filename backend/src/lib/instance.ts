// portal/src/lib/instance.ts
import { terraformManager } from './terraform'
import { logger } from './logger'
import type { Assessment } from './types/assessment'

/**
 * Parameters for provisioning a new instance.
 */
export interface ProvisionParams {
  instanceId: string
  candidateName: string
  challengeId: string
  password: string
  autoDestroyAt: number
  resourceConfig: {
    cpu: number
    memory: number
    storage: number
  }
  openaiApiKey?: string
  onData?: (data: string) => void
  onInfrastructureReady?: (accessUrl: string) => void
}

/**
 * Parameters for destroying an instance.
 */
export interface DestroyParams {
  saveFiles?: boolean
  candidateName?: string
  challenge?: string
  onData?: (data: string) => void
}

/**
 * Result of instance provisioning operation.
 */
export interface ProvisionResult {
  success: boolean
  accessUrl?: string
  error?: string
  healthCheckPassed?: boolean
  infrastructureReady?: boolean
  fullOutput?: string
}

/**
 * Result of instance destruction operation.
 */
export interface DestroyResult {
  success: boolean
  historyS3Key?: string
  error?: string
  fullOutput?: string
}

/**
 * Provisions infrastructure for an instance (interview or take-home).
 * Handles terraform operations and OpenAI service account creation.
 *
 * This function is session-type agnostic - works for both interviews and take-homes.
 */
export async function provisionInstance(
  params: ProvisionParams
): Promise<ProvisionResult> {
  try {
    if (params.onData) {
      params.onData('Starting infrastructure provisioning...\n')
    }

    // Create infrastructure with terraform
    const result = await terraformManager.createInterviewStreaming(
      {
        id: params.instanceId,
        candidateName: params.candidateName,
        challenge: params.challengeId,
        password: params.password,
        openaiApiKey: params.openaiApiKey,
      },
      params.onData,
      params.onInfrastructureReady
    )

    if (result.success) {
      logger.info('Instance provisioned successfully', {
        instanceId: params.instanceId,
        accessUrl: result.accessUrl,
      })

      return {
        success: true,
        accessUrl: result.accessUrl,
        healthCheckPassed: result.healthCheckPassed,
        infrastructureReady: result.infrastructureReady,
        fullOutput: result.fullOutput,
      }
    } else {
      logger.error('Instance provisioning failed', {
        instanceId: params.instanceId,
        error: result.error,
      })

      return {
        success: false,
        error: result.error,
        fullOutput: result.fullOutput,
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Exception during instance provisioning', {
      instanceId: params.instanceId,
      error: errorMsg,
    })

    return {
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Destroys infrastructure for an instance (interview or take-home).
 * Handles terraform destruction and file extraction if requested.
 *
 * This function is session-type agnostic - works for both interviews and take-homes.
 */
export async function destroyInstance(
  instanceId: string,
  params: DestroyParams = {}
): Promise<DestroyResult> {
  try {
    if (params.onData) {
      params.onData('Starting infrastructure destruction...\n')
    }

    // Destroy infrastructure with terraform
    const result = await terraformManager.destroyInterviewStreaming(
      instanceId,
      params.onData,
      params.candidateName,
      params.challenge,
      params.saveFiles
    )

    if (result.success) {
      logger.info('Instance destroyed successfully', {
        instanceId,
        historyS3Key: result.historyS3Key,
      })

      return {
        success: true,
        historyS3Key: result.historyS3Key,
        fullOutput: result.fullOutput,
      }
    } else {
      logger.error('Instance destruction failed', {
        instanceId,
        error: result.error,
      })

      return {
        success: false,
        error: result.error,
        fullOutput: result.fullOutput,
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Exception during instance destruction', {
      instanceId,
      error: errorMsg,
    })

    return {
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Updates the instance status for a given assessment.
 * This is a helper that delegates to the appropriate manager.
 */
export async function updateInstanceStatus(
  assessment: Assessment,
  newStatus: Assessment['instanceStatus']
): Promise<void> {
  // Implementation will be added when we refactor interview/takehome managers
  // For now, this is a placeholder
  logger.info('Updating instance status', {
    assessmentId: assessment.id,
    sessionType: assessment.sessionType,
    oldStatus: assessment.instanceStatus,
    newStatus,
  })
}
