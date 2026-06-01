import { Hono } from 'hono'
import { apiKeyManager } from '../lib/apikeys'
import { openaiService } from '../lib/openai'
import { config } from '../lib/config'

export const apikeyPublicRouter = new Hono()

/**
 * GET /api/apikey/[token]
 * Gets API key status for candidate page (public endpoint)
 */
apikeyPublicRouter.get('/:token', async (c) => {
  try {
    const token = c.req.param('token')
    const apiKey = await apiKeyManager.getApiKeyByToken(token)

    if (!apiKey) {
      return c.json({ error: 'Invalid or expired access link' }, 404)
    }

    const now = Math.floor(Date.now() / 1000)

    // Check if availability window has passed
    if (apiKey.status === 'available' && apiKey.availableUntil && apiKey.availableUntil < now) {
      return c.json({
        key: {
          status: 'expired',
          name: apiKey.name,
        },
      })
    }

    // Calculate time remaining if active
    let timeRemaining: number | undefined
    if (apiKey.status === 'active' && apiKey.expiresAt) {
      timeRemaining = Math.max(0, apiKey.expiresAt - now)
    }

    return c.json({
      key: {
        status: apiKey.status,
        name: apiKey.name,
        apiKey: apiKey.status === 'active' ? apiKey.apiKey : undefined,
        durationSeconds: apiKey.durationSeconds,
        availableUntil: apiKey.availableUntil,
        activatedAt: apiKey.activatedAt,
        expiresAt: apiKey.expiresAt,
        expiredAt: apiKey.expiredAt,
        scheduledAt: apiKey.scheduledAt,
        timeRemaining,
      },
    })
  } catch (error) {
    console.error('Error getting API key status:', error)
    return c.json({ error: 'Failed to get API key status' }, 500)
  }
})

/**
 * POST /api/apikey/[token]/activate
 * Activates an API key (creates OpenAI service account)
 */
apikeyPublicRouter.post('/:token/activate', async (c) => {
  try {
    const token = c.req.param('token')
    const apiKey = await apiKeyManager.getApiKeyByToken(token)

    if (!apiKey) {
      return c.json({ error: 'Invalid or expired access link' }, 404)
    }

    const now = Math.floor(Date.now() / 1000)

    // Check current status
    if (apiKey.status !== 'available') {
      if (apiKey.status === 'active') {
        // Already activated, return existing key
        return c.json({
          success: true,
          apiKey: apiKey.apiKey,
          expiresAt: apiKey.expiresAt,
          timeRemaining: apiKey.expiresAt ? apiKey.expiresAt - now : undefined,
        })
      } else if (apiKey.status === 'scheduled') {
        return c.json(
          {
            error: 'This API key is scheduled for future availability and cannot be activated yet',
          },
          400,
        )
      } else if (apiKey.status === 'expired') {
        return c.json({ error: 'This API key has expired and cannot be activated' }, 400)
      } else if (apiKey.status === 'revoked') {
        return c.json({ error: 'This API key has been revoked and cannot be activated' }, 400)
      } else {
        return c.json(
          {
            error: `API key cannot be activated from status: ${apiKey.status}`,
          },
          400,
        )
      }
    }

    // Check availability window
    if (apiKey.availableUntil && apiKey.availableUntil < now) {
      await apiKeyManager.updateStatus(apiKey.id, 'expired', {
        expiredAt: now,
      })
      return c.json({ error: 'This API key is no longer available' }, 400)
    }

    // Create OpenAI service account
    const result = await openaiService.createServiceAccount(
      config.services.openaiProjectId,
      `interview-${config.project.environment}-apikey-${apiKey.id}-${apiKey.name}`,
    )

    if (!result.success) {
      await apiKeyManager.updateStatus(apiKey.id, 'error')
      return c.json({ error: `Failed to create API key: ${result.error}` }, 500)
    }

    // Update key with activation details
    const expiresAt = now + apiKey.durationSeconds
    await apiKeyManager.updateStatus(apiKey.id, 'active', {
      activatedAt: now,
      expiresAt,
      serviceAccountId: result.serviceAccountId,
      apiKey: result.apiKey,
    })

    return c.json({
      success: true,
      apiKey: result.apiKey,
      expiresAt,
      timeRemaining: apiKey.durationSeconds,
    })
  } catch (error) {
    console.error('Error activating API key:', error)
    return c.json({ error: 'Failed to activate API key' }, 500)
  }
})
