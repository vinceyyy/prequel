import { operationManager } from './operations'
import { assessmentManager } from './assessments'
import { schedulerLogger } from './logger'
import { config } from './config'
import { openaiService } from './openai'
import { executeScheduledDestroy } from './scheduledExecution'

/**
 * Expires a single take-home and cleans up its OpenAI service account.
 */
export async function expireTakeHome(takeHome: {
  id: string
  availableUntil: number
  openaiServiceAccount?: { serviceAccountId: string }
}) {
  schedulerLogger.info('Expiring take-home', {
    takeHomeId: takeHome.id,
    availableUntil: new Date(takeHome.availableUntil * 1000).toISOString(),
  })

  try {
    // Delete OpenAI service account if it exists
    if (takeHome.openaiServiceAccount?.serviceAccountId) {
      schedulerLogger.info('Deleting OpenAI service account', {
        serviceAccountId: takeHome.openaiServiceAccount.serviceAccountId,
      })

      const deleteResult = await openaiService.deleteServiceAccount(
        config.services.openaiProjectId,
        takeHome.openaiServiceAccount.serviceAccountId,
      )

      if (deleteResult.success) {
        schedulerLogger.info('OpenAI service account deleted', {
          serviceAccountId: takeHome.openaiServiceAccount.serviceAccountId,
        })
      } else {
        schedulerLogger.error('OpenAI service account deletion failed', {
          serviceAccountId: takeHome.openaiServiceAccount.serviceAccountId,
          error: deleteResult.error,
        })
      }
    }

    // Update session status to expired
    await assessmentManager.updateSessionStatus(takeHome.id, 'takehome', 'expired')
    schedulerLogger.info('Take-home marked as expired', {
      takeHomeId: takeHome.id,
    })
  } catch (error) {
    schedulerLogger.error('Error expiring take-home', {
      takeHomeId: takeHome.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Auto-destroys an activated take-home that has reached its timeout.
 */
export async function autoDestroyTakeHome(takeHome: {
  id: string
  candidateName?: string
  challengeId: string
  autoDestroyAt?: number
  saveFiles?: boolean
}) {
  // Check if there's already a destroy operation in progress
  const operations = await operationManager.getOperationsByInterview(takeHome.id)
  const hasActiveDestroy = operations.some(
    (op) =>
      (op.type === 'destroy' || op.type === 'revoke_takehome') &&
      (op.status === 'pending' || op.status === 'running'),
  )

  if (hasActiveDestroy) {
    schedulerLogger.debug('Skipping auto-destroy - already in progress', {
      takeHomeId: takeHome.id,
    })
    return
  }

  schedulerLogger.info('Auto-destroying activated take-home', {
    takeHomeId: takeHome.id,
    candidateName: takeHome.candidateName,
    autoDestroyAt: takeHome.autoDestroyAt
      ? new Date(takeHome.autoDestroyAt * 1000).toISOString()
      : 'unknown',
  })

  try {
    // Update statuses
    await assessmentManager.updateSessionStatus(takeHome.id, 'takehome', 'completed')
    await assessmentManager.updateInstanceStatus(takeHome.id, 'takehome', 'destroying')

    // Create destroy operation
    const destroyOpId = await operationManager.createOperation(
      'destroy',
      takeHome.id,
      takeHome.candidateName,
      takeHome.challengeId,
      undefined,
      undefined,
      takeHome.saveFiles || true,
    )

    const destroyOp = await operationManager.getOperation(destroyOpId)
    if (destroyOp) {
      await executeScheduledDestroy({
        id: destroyOp.id,
        interviewId: destroyOp.interviewId,
        candidateName: destroyOp.candidateName,
        challenge: destroyOp.challenge,
        saveFiles: destroyOp.saveFiles,
      })
    }
  } catch (error) {
    schedulerLogger.error('Error auto-destroying activated take-home', {
      takeHomeId: takeHome.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
