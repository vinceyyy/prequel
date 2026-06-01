import { Hono } from 'hono'
import { assessmentManager } from '../lib/assessments'
import { operationManager } from '../lib/operations'
import { provisionInstance } from '../lib/instance'
import { logger } from '../lib/logger'
import { generateSecureString } from '../lib/idGenerator'
import type { TakeHomeSessionStatus } from '../lib/types/assessment'

interface StatusResponse {
  sessionStatus: TakeHomeSessionStatus
  instanceStatus?: string
  accessUrl?: string
  password?: string
  activatedAt?: string
  autoDestroyAt?: string
  destroyedAt?: string
  timeRemaining?: number
  availableFrom?: string
  availableUntil?: string
  candidateName?: string
  challengeId?: string
  additionalInstructions?: string
}

export const takehomePublicRouter = new Hono()

/**
 * GET /api/takehome/[token]
 * Returns take-home status by access token.
 * Used by candidates to check status and get access credentials.
 */
takehomePublicRouter.get('/:token', async (c) => {
  try {
    const token = c.req.param('token')

    // Look up take-home by access token
    const takeHome = await assessmentManager.getTakeHomeByToken(token)

    if (!takeHome) {
      return c.json({ error: 'Take-home not found' }, 404)
    }

    const now = Math.floor(Date.now() / 1000)

    // Build response based on session status
    const response: StatusResponse = {
      sessionStatus: takeHome.sessionStatus,
    }

    // Add fields based on session status
    switch (takeHome.sessionStatus) {
      case 'available':
        response.availableFrom = new Date(takeHome.availableFrom * 1000).toISOString()
        response.availableUntil = new Date(takeHome.availableUntil * 1000).toISOString()
        response.candidateName = takeHome.candidateName
        response.challengeId = takeHome.challengeId
        response.additionalInstructions = takeHome.additionalInstructions
        break

      case 'activated':
        response.instanceStatus = takeHome.instanceStatus
        response.additionalInstructions = takeHome.additionalInstructions

        // Safely handle activatedAt and autoDestroyAt fields
        if (takeHome.activatedAt && typeof takeHome.activatedAt === 'number') {
          response.activatedAt = new Date(takeHome.activatedAt * 1000).toISOString()
        }

        if (takeHome.autoDestroyAt && typeof takeHome.autoDestroyAt === 'number') {
          response.autoDestroyAt = new Date(takeHome.autoDestroyAt * 1000).toISOString()
          response.timeRemaining = takeHome.autoDestroyAt - now
        }

        // Only include access credentials if instance is active
        if (takeHome.instanceStatus === 'active') {
          response.accessUrl = takeHome.url
          response.password = takeHome.password
        }
        break

      case 'completed':
        response.instanceStatus = takeHome.instanceStatus

        // Safely handle activatedAt field
        if (takeHome.activatedAt && typeof takeHome.activatedAt === 'number') {
          response.activatedAt = new Date(takeHome.activatedAt * 1000).toISOString()
        }

        // Safely handle destroyedAt field
        if (takeHome.destroyedAt && typeof takeHome.destroyedAt === 'number') {
          response.destroyedAt = new Date(takeHome.destroyedAt * 1000).toISOString()
        }
        break

      case 'expired':
        response.availableFrom = new Date(takeHome.availableFrom * 1000).toISOString()
        response.availableUntil = new Date(takeHome.availableUntil * 1000).toISOString()
        break

      case 'revoked':
        // Revoked status returns minimal information
        // No additional fields needed beyond sessionStatus
        break
    }

    return c.json(response)
  } catch (error) {
    console.error('Error fetching take-home status:', error)
    return c.json({ error: 'Failed to fetch take-home status' }, 500)
  }
})

/**
 * POST /api/takehome/[token]/activate
 *
 * Activates a take-home assessment for a candidate.
 * Validates availability window, creates provisioning operation,
 * and starts background instance provisioning.
 */
takehomePublicRouter.post('/:token/activate', async (c) => {
  try {
    const token = c.req.param('token')

    // Look up take-home by access token
    const takeHome = await assessmentManager.getTakeHomeByToken(token)

    if (!takeHome) {
      return c.json({ error: 'Take-home not found' }, 404)
    }

    // Validate: sessionStatus is 'available'
    if (takeHome.sessionStatus !== 'available') {
      return c.json({ error: 'Take-home already activated or completed' }, 400)
    }

    // Validate: current time is within availableFrom/availableUntil window
    const now = Math.floor(Date.now() / 1000)
    if (now < takeHome.availableFrom || now > takeHome.availableUntil) {
      return c.json({ error: 'Take-home has expired or is not yet available' }, 400)
    }

    // Calculate autoDestroyAt based on durationHours (default 4 hours)
    const durationHours = takeHome.durationHours || 4 // Use stored duration, fallback to 4
    const autoDestroyAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)
    const activatedAt = Math.floor(Date.now() / 1000)

    // Generate secure random password for VS Code instance
    const password = generateSecureString()

    // Create operation for provisioning
    const operationId = await operationManager.createOperation(
      'create',
      takeHome.id,
      takeHome.candidateName,
      takeHome.challengeId,
      undefined, // scheduledAt (immediate activation)
      autoDestroyAt,
      false, // saveFiles
    )

    // Update take-home: sessionStatus='activated', isActivated=true, activatedAt=now, autoDestroyAt
    await assessmentManager.updateSessionStatus(takeHome.id, 'takehome', 'activated')
    await assessmentManager.updateTakeHomeActivation(
      takeHome.id,
      activatedAt,
      Math.floor(autoDestroyAt.getTime() / 1000),
    )

    // Start background provisioning using instance.provisionInstance()
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')

        const result = await provisionInstance({
          instanceId: takeHome.id,
          candidateName: takeHome.candidateName || 'Candidate',
          challengeId: takeHome.challengeId,
          password, // Securely generated random password
          autoDestroyAt: Math.floor(autoDestroyAt.getTime() / 1000),
          resourceConfig: takeHome.resourceConfig,
          openaiApiKey: takeHome.openaiServiceAccount?.apiKey,
          onData: (data: string) => {
            operationManager.addOperationLog(operationId, data)
          },
          onInfrastructureReady: (accessUrl: string) => {
            operationManager.updateOperationInfrastructureReady(operationId, accessUrl, password)
          },
        })

        logger.info('Provisioning completed', {
          takeHomeId: takeHome.id,
          operationId,
          success: result.success,
          hasAccessUrl: !!result.accessUrl,
          error: result.error,
        })

        await operationManager.addOperationLog(
          operationId,
          `Provisioning result: success=${result.success}, accessUrl=${result.accessUrl || 'none'}`,
        )

        await operationManager.setOperationResult(operationId, result)

        if (result.success) {
          logger.info('Updating instance status to active', {
            takeHomeId: takeHome.id,
          })
          await assessmentManager.updateInstanceStatus(takeHome.id, 'takehome', 'active')

          // Update access credentials if available
          if (result.accessUrl) {
            await assessmentManager.updateAccessCredentials(takeHome.id, result.accessUrl, password)
            await operationManager.addOperationLog(
              operationId,
              `✅ Access credentials updated: ${result.accessUrl}`,
            )
          }

          await operationManager.addOperationLog(
            operationId,
            '✅ Instance status updated to active',
          )
        } else {
          logger.error('Provisioning failed, updating status to error', {
            takeHomeId: takeHome.id,
            error: result.error,
          })
          await assessmentManager.updateInstanceStatus(takeHome.id, 'takehome', 'error')
          await operationManager.addOperationLog(
            operationId,
            `❌ Provisioning failed: ${result.error}`,
          )
        }
      } catch (error) {
        logger.error('Take-home activation failed', {
          takeHomeId: takeHome.id,
          operationId,
          error,
        })
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        await assessmentManager.updateInstanceStatus(takeHome.id, 'takehome', 'error')
      }
    })

    logger.info('Take-home activation started', {
      takeHomeId: takeHome.id,
      operationId,
      autoDestroyAt: autoDestroyAt.toISOString(),
    })

    return c.json({
      success: true,
      operationId,
      message: 'Take-home activation in progress',
      autoDestroyAt: autoDestroyAt.toISOString(),
    })
  } catch (error) {
    logger.error('Failed to activate take-home', { error })
    return c.json(
      {
        error: 'Failed to activate take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    )
  }
})
