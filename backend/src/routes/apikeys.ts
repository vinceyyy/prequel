import { Hono } from 'hono'
import { apiKeyManager } from '../lib/apikeys'
import { listAllApiKeys, clearOpenAICache } from '../lib/apiKeyListService'
import { openaiService } from '../lib/openai'
import { config } from '../lib/config'
import { generateId } from '../lib/idGenerator'
import type { CreateApiKeyRequest } from '../lib/types/apikey'

export const apikeysRouter = new Hono()

/**
 * GET /api/apikeys
 * Lists all API keys from all sources with orphan detection
 */
apikeysRouter.get('/', async (c) => {
  try {
    const result = await listAllApiKeys()
    return c.json(result)
  } catch (error) {
    console.error('Error listing API keys:', error)
    return c.json({ error: 'Failed to list API keys' }, 500)
  }
})

/**
 * POST /api/apikeys/create
 * Creates a new standalone API key
 */
apikeysRouter.post('/create', async (c) => {
  try {
    const body: CreateApiKeyRequest = await c.req.json()
    const {
      name,
      description,
      activationMode,
      durationSeconds,
      scheduledAt,
      availableDays,
    } = body

    // Validation
    if (!name?.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }

    if (!durationSeconds || durationSeconds <= 0) {
      return c.json({ error: 'Duration is required' }, 400)
    }

    // Max duration: 7 days
    const maxDuration = 7 * 24 * 60 * 60
    if (durationSeconds > maxDuration) {
      return c.json({ error: 'Maximum duration is 7 days' }, 400)
    }

    // Generate ID upfront so we can use it in service account name
    const apiKeyId = generateId()
    const now = Math.floor(Date.now() / 1000)
    let status: 'scheduled' | 'available' | 'active'
    let serviceAccountId: string | undefined
    let apiKey: string | undefined
    let activatedAt: number | undefined
    let expiresAt: number | undefined
    let availableUntil: number | undefined
    let scheduledAtTimestamp: number | undefined

    if (activationMode === 'immediate') {
      // Create OpenAI service account immediately
      if (!config.services.openaiProjectId || !config.services.openaiAdminKey) {
        return c.json({ error: 'OpenAI not configured' }, 500)
      }

      const result = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${config.project.environment}-apikey-${apiKeyId}-${name.trim()}`
      )

      if (!result.success) {
        return c.json(
          { error: `Failed to create OpenAI key: ${result.error}` },
          500
        )
      }

      status = 'active'
      serviceAccountId = result.serviceAccountId
      apiKey = result.apiKey
      activatedAt = now
      expiresAt = now + durationSeconds
    } else if (activationMode === 'scheduled') {
      if (!scheduledAt) {
        return c.json(
          { error: 'scheduledAt is required for scheduled mode' },
          400
        )
      }

      scheduledAtTimestamp = Math.floor(new Date(scheduledAt).getTime() / 1000)
      if (scheduledAtTimestamp <= now) {
        return c.json({ error: 'scheduledAt must be in the future' }, 400)
      }

      status = 'scheduled'
      // expiresAt will be set when activated
    } else if (activationMode === 'recipient') {
      const days = availableDays || 7
      availableUntil = now + days * 24 * 60 * 60
      status = 'available'
      // expiresAt will be set when activated
    } else {
      return c.json({ error: 'Invalid activation mode' }, 400)
    }

    const createdKey = await apiKeyManager.createApiKey({
      id: apiKeyId,
      name: name.trim(),
      description: description?.trim(),
      status,
      provider: 'openai',
      activationMode,
      durationSeconds,
      serviceAccountId,
      apiKey,
      activatedAt,
      expiresAt,
      availableUntil,
      scheduledAt: scheduledAtTimestamp,
    })

    return c.json({
      success: true,
      apiKey: createdKey,
    })
  } catch (error) {
    console.error('Error creating API key:', error)
    return c.json({ error: 'Failed to create API key' }, 500)
  }
})

/**
 * POST /api/apikeys/[id]/revoke
 * Revokes an API key (deletes from OpenAI and marks as revoked)
 */
apikeysRouter.post('/:id/revoke', async (c) => {
  try {
    const id = c.req.param('id')

    // Handle orphan deletion (id starts with 'orphan-')
    if (id.startsWith('orphan-')) {
      const serviceAccountId = id.replace('orphan-', '')

      if (config.services.openaiProjectId) {
        const result = await openaiService.deleteServiceAccount(
          config.services.openaiProjectId,
          serviceAccountId
        )

        if (!result.success) {
          return c.json(
            { error: `Failed to delete orphan: ${result.error}` },
            500
          )
        }

        // Clear cache so orphan disappears from list immediately
        clearOpenAICache()
      }

      return c.json({ success: true })
    }

    // Handle regular API key revocation
    const apiKey = await apiKeyManager.getApiKey(id)

    if (!apiKey) {
      return c.json({ error: 'API key not found' }, 404)
    }

    // Delete from OpenAI if service account exists
    if (apiKey.serviceAccountId && config.services.openaiProjectId) {
      const result = await openaiService.deleteServiceAccount(
        config.services.openaiProjectId,
        apiKey.serviceAccountId
      )

      if (!result.success) {
        console.error('Failed to delete OpenAI service account:', result.error)
        // Continue with status update even if OpenAI deletion fails
      }
    }

    // Update status to revoked
    const now = Math.floor(Date.now() / 1000)
    await apiKeyManager.updateStatus(apiKey.id, 'revoked', { expiredAt: now })

    return c.json({ success: true })
  } catch (error) {
    console.error('Error revoking API key:', error)
    return c.json({ error: 'Failed to revoke API key' }, 500)
  }
})

/**
 * GET /api/apikeys/[id]
 * Gets a single API key by ID
 */
apikeysRouter.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const apiKey = await apiKeyManager.getApiKey(id)

    if (!apiKey) {
      return c.json({ error: 'API key not found' }, 404)
    }

    return c.json({ apiKey })
  } catch (error) {
    console.error('Error getting API key:', error)
    return c.json({ error: 'Failed to get API key' }, 500)
  }
})

/**
 * DELETE /api/apikeys/[id]
 * Deletes an API key record from history
 */
apikeysRouter.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    await apiKeyManager.deleteApiKey(id)
    return c.json({ success: true })
  } catch (error) {
    console.error('Error deleting API key:', error)
    return c.json({ error: 'Failed to delete API key' }, 500)
  }
})
