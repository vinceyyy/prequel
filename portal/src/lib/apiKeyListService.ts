/**
 * Service for listing all API keys with orphan detection.
 * Merges keys from standalone, interviews, and take-homes.
 */

import { apiKeyManager } from './apikeys'
import { interviewManager } from './interviews'
import { assessmentManager } from './assessments'
import { openaiService } from './openai'
import { config } from './config'
import { logger } from './logger'
import type {
  ApiKeyView,
  ApiKeyListResponse,
  ApiKeyStatus,
} from './types/apikey'
import type { Interview } from './interviews'
import type { TakeHome } from './types/assessment'

// Cache for OpenAI service accounts (30 second TTL)
let openaiAccountsCache: {
  accounts: Array<{ id: string; name: string; created_at: number }>
  timestamp: number
} | null = null
const CACHE_TTL_MS = 30000

/**
 * Maps interview status to API key status
 */
function mapInterviewStatusToKeyStatus(status: string): ApiKeyStatus {
  switch (status) {
    case 'scheduled':
      return 'scheduled'
    case 'initializing':
    case 'configuring':
    case 'active':
      return 'active'
    case 'destroying':
    case 'destroyed':
      return 'expired'
    case 'error':
      return 'error'
    default:
      return 'expired'
  }
}

/**
 * Maps take-home session status to API key status
 */
function mapTakeHomeStatusToKeyStatus(
  sessionStatus: string,
  instanceStatus: string
): ApiKeyStatus {
  if (sessionStatus === 'available') return 'available'
  if (sessionStatus === 'activated') {
    if (['initializing', 'configuring', 'active'].includes(instanceStatus))
      return 'active'
    if (['destroying', 'destroyed'].includes(instanceStatus)) return 'expired'
  }
  if (['completed', 'expired', 'revoked'].includes(sessionStatus))
    return 'expired'
  return 'error'
}

/**
 * Gets cached OpenAI accounts or fetches fresh
 */
async function getOpenAIAccounts(): Promise<{
  accounts: Array<{ id: string; name: string; created_at: number }>
  success: boolean
}> {
  const now = Date.now()

  // Return cached if still valid
  if (openaiAccountsCache && now - openaiAccountsCache.timestamp < CACHE_TTL_MS) {
    return { accounts: openaiAccountsCache.accounts, success: true }
  }

  // Fetch fresh
  try {
    const result = await openaiService.listServiceAccounts(
      config.services.openaiProjectId
    )

    if (result.success && result.accounts) {
      openaiAccountsCache = { accounts: result.accounts, timestamp: now }
      return { accounts: result.accounts, success: true }
    }

    return { accounts: [], success: false }
  } catch (error) {
    logger.warn('Failed to fetch OpenAI accounts for orphan detection', {
      error,
    })
    return { accounts: [], success: false }
  }
}

/**
 * Lists all API keys from all sources with orphan detection
 */
export async function listAllApiKeys(): Promise<ApiKeyListResponse> {
  const keys: ApiKeyView[] = []
  let orphanCheckFailed = false

  try {
    // Fetch all sources in parallel
    const [standaloneKeys, interviews, takeHomes, openaiResult] =
      await Promise.all([
        apiKeyManager.getActiveKeys().catch(() => []),
        interviewManager.getActiveInterviews().catch(() => []),
        assessmentManager.listTakeHomes().catch(() => []),
        getOpenAIAccounts(),
      ])

    // Also get historical standalone keys
    const historicalKeys = await apiKeyManager
      .getHistoricalKeys()
      .catch(() => [])

    // Track known service account IDs
    const knownServiceAccountIds = new Set<string>()

    // Map standalone keys
    for (const key of [...standaloneKeys, ...historicalKeys]) {
      if (key.serviceAccountId) {
        knownServiceAccountIds.add(key.serviceAccountId)
      }
      keys.push({
        id: key.id,
        name: key.name,
        description: key.description,
        status: key.status,
        provider: key.provider,
        source: 'standalone',
        apiKey: key.apiKey,
        accessToken: key.accessToken,
        createdAt: key.createdAt,
        scheduledAt: key.scheduledAt,
        activatedAt: key.activatedAt,
        expiresAt: key.expiresAt,
        expiredAt: key.expiredAt,
      })
    }

    // Map interview keys
    for (const interview of interviews) {
      if (interview.openaiServiceAccountId) {
        knownServiceAccountIds.add(interview.openaiServiceAccountId)
        keys.push({
          id: `interview-${interview.id}`,
          name: interview.candidateName,
          description: `Interview: ${interview.challenge}`,
          status: mapInterviewStatusToKeyStatus(interview.status),
          provider: 'openai',
          source: 'interview',
          sourceId: interview.id,
          createdAt: Math.floor(interview.createdAt.getTime() / 1000),
          expiresAt: interview.autoDestroyAt
            ? Math.floor(interview.autoDestroyAt.getTime() / 1000)
            : undefined,
        })
      }
    }

    // Map take-home keys
    for (const takeHome of takeHomes) {
      if (takeHome.openaiServiceAccount?.serviceAccountId) {
        knownServiceAccountIds.add(
          takeHome.openaiServiceAccount.serviceAccountId
        )
        keys.push({
          id: `takehome-${takeHome.id}`,
          name: takeHome.candidateName || 'Unknown',
          description: `Take-home: ${takeHome.challengeId}`,
          status: mapTakeHomeStatusToKeyStatus(
            takeHome.sessionStatus,
            takeHome.instanceStatus
          ),
          provider: 'openai',
          source: 'takehome',
          sourceId: takeHome.id,
          createdAt: takeHome.createdAt,
          activatedAt: takeHome.activatedAt,
          expiresAt: takeHome.autoDestroyAt,
        })
      }
    }

    // Detect orphan keys
    if (openaiResult.success) {
      for (const account of openaiResult.accounts) {
        if (!knownServiceAccountIds.has(account.id)) {
          keys.push({
            id: `orphan-${account.id}`,
            name: account.name || account.id,
            description: 'Orphan service account - not tracked in database',
            status: 'orphan',
            provider: 'openai',
            source: 'unknown',
            createdAt: account.created_at,
          })
        }
      }
    } else {
      orphanCheckFailed = true
    }

    // Sort: orphans first, then by createdAt descending
    keys.sort((a, b) => {
      if (a.status === 'orphan' && b.status !== 'orphan') return -1
      if (a.status !== 'orphan' && b.status === 'orphan') return 1
      return b.createdAt - a.createdAt
    })

    // Count active keys
    const activeCount = keys.filter((k) => k.status === 'active').length

    return { keys, activeCount, orphanCheckFailed }
  } catch (error) {
    logger.error('Failed to list API keys', { error })
    throw error
  }
}

/**
 * Clears the OpenAI accounts cache (for testing)
 */
export function clearOpenAICache(): void {
  openaiAccountsCache = null
}
