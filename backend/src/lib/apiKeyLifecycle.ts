import { config } from './config'
import { openaiService } from './openai'
import { schedulerLogger } from './logger'
import { apiKeyManager } from './apikeys'

/**
 * Processes API keys: scheduled activation and expiration.
 * Called every 30 seconds as part of the scheduler tick.
 */
export async function processApiKeys() {
  try {
    await processScheduledApiKeys()
    await processExpiredApiKeys()
    await processExpiredAvailableApiKeys()
  } catch (error) {
    schedulerLogger.error('Error in processApiKeys', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Processes scheduled API keys that are due for activation.
 */
export async function processScheduledApiKeys() {
  try {
    const scheduledKeys = await apiKeyManager.getScheduledKeys()
    const now = Math.floor(Date.now() / 1000)

    for (const key of scheduledKeys) {
      if (key.scheduledAt && key.scheduledAt <= now) {
        schedulerLogger.info('Activating scheduled API key', {
          apiKeyId: key.id,
          name: key.name,
        })

        try {
          // Create OpenAI service account
          if (config.services.openaiProjectId && config.services.openaiAdminKey) {
            const result = await openaiService.createServiceAccount(
              config.services.openaiProjectId,
              `interview-${config.project.environment}-apikey-${key.id}-${key.name}`,
            )

            if (result.success) {
              const expiresAt = now + key.durationSeconds
              await apiKeyManager.updateStatus(key.id, 'active', {
                activatedAt: now,
                expiresAt,
                serviceAccountId: result.serviceAccountId,
                apiKey: result.apiKey,
              })

              schedulerLogger.info('Scheduled API key activated', {
                apiKeyId: key.id,
              })
            } else {
              await apiKeyManager.updateStatus(key.id, 'error')
              schedulerLogger.error('Failed to activate scheduled API key', {
                apiKeyId: key.id,
                error: result.error,
              })
            }
          } else {
            // OpenAI not configured - cannot activate
            await apiKeyManager.updateStatus(key.id, 'error')
            schedulerLogger.error('Cannot activate scheduled API key - OpenAI not configured', {
              apiKeyId: key.id,
            })
          }
        } catch (error) {
          await apiKeyManager.updateStatus(key.id, 'error')
          schedulerLogger.error('Error activating scheduled API key', {
            apiKeyId: key.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }
  } catch (error) {
    schedulerLogger.error('Error in processScheduledApiKeys', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Processes active API keys that have expired.
 */
export async function processExpiredApiKeys() {
  try {
    const expiredKeys = await apiKeyManager.getExpiredActiveKeys()
    const now = Math.floor(Date.now() / 1000)

    for (const key of expiredKeys) {
      schedulerLogger.info('Expiring API key', {
        apiKeyId: key.id,
        name: key.name,
      })

      try {
        // Delete OpenAI service account
        if (key.serviceAccountId && config.services.openaiProjectId) {
          const result = await openaiService.deleteServiceAccount(
            config.services.openaiProjectId,
            key.serviceAccountId,
          )

          if (!result.success) {
            schedulerLogger.warn('Failed to delete OpenAI service account', {
              apiKeyId: key.id,
              serviceAccountId: key.serviceAccountId,
              error: result.error,
            })
          }
        }

        await apiKeyManager.updateStatus(key.id, 'expired', {
          expiredAt: now,
        })

        schedulerLogger.info('API key expired', { apiKeyId: key.id })
      } catch (error) {
        schedulerLogger.error('Error expiring API key', {
          apiKeyId: key.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  } catch (error) {
    schedulerLogger.error('Error in processExpiredApiKeys', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Processes available API keys that are past their availability window.
 */
export async function processExpiredAvailableApiKeys() {
  try {
    const expiredKeys = await apiKeyManager.getExpiredAvailableKeys()
    const now = Math.floor(Date.now() / 1000)

    for (const key of expiredKeys) {
      schedulerLogger.info('Expiring available API key', {
        apiKeyId: key.id,
        name: key.name,
      })

      await apiKeyManager.updateStatus(key.id, 'expired', { expiredAt: now })

      schedulerLogger.info('Available API key expired', { apiKeyId: key.id })
    }
  } catch (error) {
    schedulerLogger.error('Error in processExpiredAvailableApiKeys', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
