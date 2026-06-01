import { Hono } from 'hono'
import { assessmentManager } from '../lib/assessments'
import { operationManager } from '../lib/operations'
import { destroyInstance } from '../lib/instance'
import { openaiService } from '../lib/openai'
import { logger } from '../lib/logger'
import { config } from '../lib/config'
import { generateId, generateSecureString } from '../lib/idGenerator'
import type { TakeHome } from '../lib/types/assessment'

interface TakeHomeListItem {
  id: string
  candidateName?: string
  candidateEmail?: string
  challengeId: string
  sessionStatus: string
  instanceStatus: string
  createdAt: string
  availableFrom: string
  availableUntil: string
  activatedAt?: string
  autoDestroyAt?: string
  destroyedAt?: string
  accessToken: string
  url?: string
  password?: string
  saveFiles?: boolean
}

export const takehomesRouter = new Hono()

/**
 * GET /api/takehomes
 * Returns list of all take-homes for manager dashboard.
 * Take-homes are sorted by creation date descending (newest first).
 */
takehomesRouter.get('/', async (c) => {
  try {
    // Get all take-homes from DynamoDB (already sorted by createdAt desc)
    const takeHomes = await assessmentManager.listTakeHomes()

    // Convert to API format with all fields needed for UI
    const takeHomeList: TakeHomeListItem[] = takeHomes.map((takeHome) => {
      const item: TakeHomeListItem = {
        id: takeHome.id,
        candidateName: takeHome.candidateName,
        candidateEmail: takeHome.candidateEmail,
        challengeId: takeHome.challengeId,
        sessionStatus: takeHome.sessionStatus,
        instanceStatus: takeHome.instanceStatus,
        createdAt: new Date(takeHome.createdAt * 1000).toISOString(),
        availableFrom: new Date(takeHome.availableFrom * 1000).toISOString(),
        availableUntil: new Date(takeHome.availableUntil * 1000).toISOString(),
        accessToken: takeHome.accessToken,
        url: takeHome.url,
        password: takeHome.password,
      }

      // Add activatedAt if take-home has been activated
      if (takeHome.activatedAt) {
        item.activatedAt = new Date(takeHome.activatedAt * 1000).toISOString()
      }

      // Add autoDestroyAt if present
      if (takeHome.autoDestroyAt) {
        item.autoDestroyAt = new Date(takeHome.autoDestroyAt * 1000).toISOString()
      }

      // Add destroyedAt if present
      if (takeHome.destroyedAt) {
        item.destroyedAt = new Date(takeHome.destroyedAt * 1000).toISOString()
      }

      // Add saveFiles flag if present
      if (takeHome.saveFiles !== undefined) {
        item.saveFiles = takeHome.saveFiles
      }

      return item
    })

    return c.json({ takeHomes: takeHomeList })
  } catch (error) {
    console.error('Error listing take-homes:', error)
    return c.json({ error: 'Failed to list take-homes' }, 500)
  }
})

takehomesRouter.post('/create', async (c) => {
  try {
    const body = await c.req.json()
    const {
      candidateName,
      candidateEmail,
      challengeId,
      availableDays = 7,
      durationHours = 4,
      additionalInstructions,
    } = body

    // Validate required fields
    if (!candidateName || !challengeId) {
      return c.json({ error: 'candidateName and challengeId are required' }, 400)
    }

    // Generate IDs
    const takeHomeId = generateId()
    const accessToken = generateSecureString()

    // Calculate timestamps
    const now = Math.floor(Date.now() / 1000)
    const availableFrom = now
    const availableUntil = now + availableDays * 24 * 60 * 60

    // Create OpenAI service account if configured
    let openaiServiceAccount
    try {
      const serviceAccountResult = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${config.project.environment}-takehome-${takeHomeId}-${candidateName}`,
      )
      if (
        serviceAccountResult.success &&
        serviceAccountResult.apiKey &&
        serviceAccountResult.serviceAccountId
      ) {
        openaiServiceAccount = {
          apiKey: serviceAccountResult.apiKey,
          projectId: config.services.openaiProjectId,
          serviceAccountId: serviceAccountResult.serviceAccountId,
        }
      }
    } catch (error) {
      logger.warn('Failed to create OpenAI service account', {
        takeHomeId,
        error,
      })
    }

    // Create take-home record
    const takeHome: Omit<TakeHome, 'createdAt'> = {
      PK: `TAKEHOME#${takeHomeId}`,
      SK: 'METADATA',
      sessionType: 'takehome',
      id: takeHomeId,
      accessToken,
      availableFrom,
      availableUntil,
      isActivated: false,
      sessionStatus: 'available',
      createdBy: 'admin', // TODO: Get from auth context
      candidateName,
      candidateEmail,
      additionalInstructions,
      durationHours,
      instanceStatus: 'pending',
      challengeId,
      autoDestroyAt: undefined, // Set when activated
      resourceConfig: {
        cpu: 1024, // TODO: Get from challenge config
        memory: 2048,
        storage: 20,
      },
      openaiServiceAccount,
    }

    await assessmentManager.createTakeHome(takeHome)

    // Generate access URL
    const protocol = c.req.header('x-forwarded-proto') || 'http'
    const host = c.req.header('host') || 'localhost'
    const accessUrl = `${protocol}://${host}/takehome/${accessToken}`

    logger.info('Take-home created', {
      takeHomeId,
      candidateName,
      accessUrl,
    })

    return c.json({
      success: true,
      takeHomeId,
      accessToken,
      accessUrl,
      availableFrom: new Date(availableFrom * 1000).toISOString(),
      availableUntil: new Date(availableUntil * 1000).toISOString(),
    })
  } catch (error) {
    logger.error('Failed to create take-home', { error })
    return c.json(
      {
        error: 'Failed to create take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    )
  }
})

/**
 * POST endpoint for managers to revoke take-home assessments.
 *
 * Behavior:
 * - For non-activated take-homes (available): Update sessionStatus to 'revoked' immediately
 * - For activated take-homes: Create destroy operation, trigger infrastructure cleanup, and set sessionStatus to 'revoked'
 * - Always clean up OpenAI service accounts if they exist
 * - Always save files (saveFiles: true) for revoked take-homes
 * - Prevents revocation if take-home is already in destroying state
 * - Prevents duplicate revoke operations
 */
takehomesRouter.post('/:id/revoke', async (c) => {
  try {
    const id = c.req.param('id')

    logger.info('Revoke take-home request received', { id })

    // Get take-home record
    const assessment = await assessmentManager.getAssessment(id)

    if (!assessment) {
      logger.warn('Take-home not found in database', { id })
      return c.json({ error: 'Take-home not found' }, 404)
    }

    logger.info('Take-home found', {
      id,
      sessionType: assessment.sessionType,
      sessionStatus: assessment.sessionStatus,
      instanceStatus: assessment.instanceStatus,
    })

    // Verify it's a take-home (not an interview)
    if (assessment.sessionType !== 'takehome') {
      return c.json({ error: 'This endpoint is for take-homes only' }, 400)
    }

    // Check if already in a terminal state
    if (
      assessment.sessionStatus === 'completed' ||
      assessment.sessionStatus === 'expired' ||
      assessment.sessionStatus === 'revoked'
    ) {
      return c.json(
        {
          error: `Cannot revoke - take-home is already ${assessment.sessionStatus}`,
        },
        400,
      )
    }

    // Check if currently destroying
    if (assessment.instanceStatus === 'destroying') {
      return c.json({ error: 'Cannot revoke - already destroying' }, 400)
    }

    // Check for existing revoke operations to prevent duplicates
    const existingOperations = await operationManager.getOperationsByInterview(id)
    const hasActiveRevoke = existingOperations.some(
      (op) => op.type === 'revoke_takehome' && (op.status === 'pending' || op.status === 'running'),
    )

    if (hasActiveRevoke) {
      return c.json({ error: 'Revocation already in progress' }, 400)
    }

    // Check if take-home has been activated (has infrastructure)
    const isActivated = assessment.sessionStatus === 'activated'

    if (isActivated) {
      // Take-home has infrastructure - trigger background destruction
      logger.info('Initiating destruction for activated take-home (revoke)', {
        takeHomeId: id,
        candidateName: assessment.candidateName,
      })

      // Create operation to track progress
      const operationId = await operationManager.createOperation(
        'revoke_takehome',
        id,
        assessment.candidateName,
        assessment.challengeId,
        undefined, // scheduledAt
        undefined, // autoDestroyAt
        true, // saveFiles - always save files for revoked take-homes
      )

      // Start background operation
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, 'running')
          await operationManager.addOperationLog(
            operationId,
            `Starting take-home revocation for ${id}`,
          )

          // Update session status to 'revoked' and instance status to 'destroying'
          await assessmentManager.updateSessionStatus(id, 'takehome', 'revoked')
          await assessmentManager.updateInstanceStatus(id, 'takehome', 'destroying')
          await operationManager.addOperationLog(
            operationId,
            'Take-home status set to revoked, destroying infrastructure',
          )

          // Delete OpenAI service account if exists
          if (assessment.openaiServiceAccount) {
            await operationManager.addOperationLog(
              operationId,
              'Deleting OpenAI service account...',
            )

            const deleteResult = await openaiService.deleteServiceAccount(
              assessment.openaiServiceAccount.projectId,
              assessment.openaiServiceAccount.serviceAccountId,
            )

            if (deleteResult.success) {
              await operationManager.addOperationLog(
                operationId,
                'OpenAI service account deleted successfully',
              )
            } else {
              await operationManager.addOperationLog(
                operationId,
                `OpenAI service account deletion failed: ${deleteResult.error}`,
              )
            }
          }

          // Destroy infrastructure
          const result = await destroyInstance(id, {
            saveFiles: true, // Always save files for revoked take-homes
            candidateName: assessment.candidateName,
            challenge: assessment.challengeId,
            onData: (data: string) => {
              const lines = data.split('\n').filter((line) => line.trim())
              lines.forEach((line) => {
                operationManager.addOperationLog(operationId, line).catch(console.error)
              })
            },
          })

          if (result.success) {
            await operationManager.addOperationLog(
              operationId,
              'Infrastructure destroyed successfully',
            )

            await operationManager.addOperationLog(operationId, 'Take-home revoked successfully!')

            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key,
            })
          } else {
            await operationManager.addOperationLog(operationId, 'Take-home revocation failed')
            await operationManager.addOperationLog(operationId, `Error: ${result.error}`)

            await operationManager.setOperationResult(operationId, {
              success: false,
              error: result.error,
              fullOutput: result.fullOutput,
            })
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          await operationManager.addOperationLog(operationId, `Error: ${errorMsg}`)
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: errorMsg,
          })
        }
      })

      return c.json({
        success: true,
        operationId,
        message: 'Revocation initiated',
      })
    } else {
      // Take-home has not been activated - update status directly
      logger.info('Revoking non-activated take-home', {
        takeHomeId: id,
        sessionStatus: assessment.sessionStatus,
      })

      // Delete OpenAI service account if exists
      if (assessment.openaiServiceAccount) {
        try {
          await openaiService.deleteServiceAccount(
            assessment.openaiServiceAccount.projectId,
            assessment.openaiServiceAccount.serviceAccountId,
          )
          logger.info('OpenAI service account deleted', { takeHomeId: id })
        } catch (error) {
          logger.warn('Failed to delete OpenAI service account', {
            takeHomeId: id,
            error,
          })
          // Continue with revocation even if OpenAI cleanup fails
        }
      }

      // Update session status to 'revoked'
      await assessmentManager.updateSessionStatus(id, 'takehome', 'revoked')

      return c.json({
        success: true,
        message: 'Take-home revoked successfully',
      })
    }
  } catch (error) {
    logger.error('Failed to revoke take-home', { error })
    return c.json(
      {
        error: 'Failed to revoke take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    )
  }
})

/**
 * DELETE endpoint for managers to delete take-home assessments.
 *
 * Behavior:
 * - For non-activated take-homes (available/expired): Delete immediately from DynamoDB
 * - For activated take-homes: Create destroy operation and trigger infrastructure cleanup
 * - Always clean up OpenAI service accounts if they exist
 */
takehomesRouter.post('/:id/delete', async (c) => {
  try {
    const id = c.req.param('id')

    logger.info('Delete take-home request received', { id })

    // Get take-home record
    const assessment = await assessmentManager.getAssessment(id)

    if (!assessment) {
      logger.warn('Take-home not found in database', { id })
      return c.json({ error: 'Take-home not found' }, 404)
    }

    logger.info('Take-home found', {
      id,
      sessionType: assessment.sessionType,
      sessionStatus: assessment.sessionStatus,
    })

    // Verify it's a take-home (not an interview)
    if (assessment.sessionType !== 'takehome') {
      return c.json({ error: 'This endpoint is for take-homes only, not a take-home' }, 400)
    }

    // Check if take-home has been activated (has infrastructure)
    const isActivated = assessment.sessionStatus === 'activated'

    if (isActivated) {
      // Take-home has infrastructure - trigger background destruction
      logger.info('Initiating destruction for activated take-home', {
        takeHomeId: id,
        candidateName: assessment.candidateName,
      })

      // Create operation to track progress
      const operationId = await operationManager.createOperation(
        'destroy',
        id,
        assessment.candidateName,
        assessment.challengeId,
      )

      // Start background operation
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, 'running')
          await operationManager.addOperationLog(
            operationId,
            `Starting take-home destruction for ${id}`,
          )

          // Delete OpenAI service account if exists
          if (assessment.openaiServiceAccount) {
            await operationManager.addOperationLog(
              operationId,
              'Deleting OpenAI service account...',
            )

            const deleteResult = await openaiService.deleteServiceAccount(
              assessment.openaiServiceAccount.projectId,
              assessment.openaiServiceAccount.serviceAccountId,
            )

            if (deleteResult.success) {
              await operationManager.addOperationLog(
                operationId,
                'OpenAI service account deleted successfully',
              )
            } else {
              await operationManager.addOperationLog(
                operationId,
                `OpenAI service account deletion failed: ${deleteResult.error}`,
              )
            }
          }

          // Destroy infrastructure
          const result = await destroyInstance(id, {
            saveFiles: assessment.saveFiles,
            candidateName: assessment.candidateName,
            challenge: assessment.challengeId,
            onData: (data: string) => {
              const lines = data.split('\n').filter((line) => line.trim())
              lines.forEach((line) => {
                operationManager.addOperationLog(operationId, line).catch(console.error)
              })
            },
          })

          if (result.success) {
            await operationManager.addOperationLog(
              operationId,
              'Infrastructure destroyed successfully',
            )

            await operationManager.addOperationLog(operationId, 'Take-home destroyed successfully!')

            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key,
            })
          } else {
            await operationManager.addOperationLog(operationId, 'Take-home destruction failed')
            await operationManager.addOperationLog(operationId, `Error: ${result.error}`)

            await operationManager.setOperationResult(operationId, {
              success: false,
              error: result.error,
              fullOutput: result.fullOutput,
            })
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          await operationManager.addOperationLog(operationId, `Error: ${errorMsg}`)
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: errorMsg,
          })
        }
      })

      return c.json({
        success: true,
        operationId,
        message: 'Destruction initiated',
      })
    } else {
      // Take-home has not been activated - delete directly from DynamoDB
      logger.info('Deleting non-activated take-home', {
        takeHomeId: id,
        sessionStatus: assessment.sessionStatus,
      })

      // Delete OpenAI service account if exists
      if (assessment.openaiServiceAccount) {
        try {
          await openaiService.deleteServiceAccount(
            assessment.openaiServiceAccount.projectId,
            assessment.openaiServiceAccount.serviceAccountId,
          )
          logger.info('OpenAI service account deleted', { takeHomeId: id })
        } catch (error) {
          logger.warn('Failed to delete OpenAI service account', {
            takeHomeId: id,
            error,
          })
          // Continue with deletion even if OpenAI cleanup fails
        }
      }

      // Delete from DynamoDB
      await assessmentManager.deleteTakeHome(id)

      return c.json({
        success: true,
        message: 'Take-home deleted successfully',
      })
    }
  } catch (error) {
    logger.error('Failed to delete take-home', { error })
    return c.json(
      {
        error: 'Failed to delete take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    )
  }
})
