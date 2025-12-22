/**
 * API Key types for the API Key Manager
 */

/**
 * Status of an API key in its lifecycle
 */
export type ApiKeyStatus =
  | 'scheduled' // Waiting for scheduled start time
  | 'available' // Recipient can activate (shareable mode)
  | 'active' // Key is provisioned and usable
  | 'expired' // Key was deleted after duration ended
  | 'revoked' // Manually deleted before expiration
  | 'error' // Something went wrong

/**
 * Source of an API key
 */
export type ApiKeySource = 'standalone' | 'interview' | 'takehome' | 'unknown'

/**
 * API key provider type (extensible for future providers)
 */
export type ApiKeyProvider = 'openai'

/**
 * Activation mode for API key creation
 */
export type ApiKeyActivationMode = 'immediate' | 'scheduled' | 'recipient'

/**
 * API Key record stored in DynamoDB
 */
export interface ApiKey {
  id: string
  name: string
  description?: string
  status: ApiKeyStatus
  provider: ApiKeyProvider
  serviceAccountId?: string
  apiKey?: string
  accessToken?: string
  activationMode: ApiKeyActivationMode
  createdAt: number
  scheduledAt?: number
  activatedAt?: number
  expiresAt?: number
  expiredAt?: number
  availableUntil?: number
  durationSeconds: number
  ttl?: number
}

/**
 * Unified view of an API key (used in list responses)
 * Combines standalone keys with interview/take-home keys
 */
export interface ApiKeyView {
  id: string
  name: string
  description?: string
  status: ApiKeyStatus | 'orphan'
  provider: ApiKeyProvider
  source: ApiKeySource
  sourceId?: string
  apiKey?: string
  accessToken?: string
  createdAt: number
  scheduledAt?: number
  activatedAt?: number
  expiresAt?: number
  expiredAt?: number
}

/**
 * Request body for creating a new API key
 */
export interface CreateApiKeyRequest {
  name: string
  description?: string
  activationMode: ApiKeyActivationMode
  durationSeconds: number
  scheduledAt?: string
  availableDays?: number
}

/**
 * Response from listing API keys
 */
export interface ApiKeyListResponse {
  keys: ApiKeyView[]
  activeCount: number
  orphanCheckFailed?: boolean
}
