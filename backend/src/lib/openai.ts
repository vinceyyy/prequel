/**
 * OpenAI Service for managing project service accounts.
 *
 * This module handles dynamic creation and deletion of OpenAI service accounts
 * for coding interviews, ensuring each interview has isolated API access.
 */

import { config } from './config'
import { logger } from './logger'

/**
 * Response from creating a service account
 */
export interface CreateServiceAccountResult {
  success: boolean
  serviceAccountId?: string
  apiKey?: string
  error?: string
}

/**
 * Response from deleting a service account
 */
export interface DeleteServiceAccountResult {
  success: boolean
  deleted?: boolean
  error?: string
}

/**
 * OpenAI API response for service account creation
 */
interface OpenAIServiceAccountResponse {
  object: string
  id: string
  name: string
  role: string
  created_at: number
  api_key: {
    object: string
    value: string
    name: string
    created_at: number
    id: string
  }
}

/**
 * OpenAI API response for service account deletion
 */
interface OpenAIDeleteResponse {
  object: string
  id: string
  deleted: boolean
}

/**
 * Service account from OpenAI API list response
 */
export interface ServiceAccount {
  id: string
  name: string
  role: string
  created_at: number
}

/**
 * Response from listing service accounts
 */
export interface ListServiceAccountsResult {
  success: boolean
  accounts?: ServiceAccount[]
  error?: string
}

class OpenAIService {
  private readonly adminKey: string
  private readonly projectId: string
  private readonly baseUrl = 'https://api.openai.com/v1'

  constructor() {
    this.adminKey = config.services.openaiAdminKey
    this.projectId = config.services.openaiProjectId

    if (!this.adminKey) {
      logger.warn('OPENAI_ADMIN_KEY not configured - OpenAI features disabled')
    }
    if (!this.projectId) {
      logger.warn('OPENAI_PROJECT_ID not configured - OpenAI features disabled')
    }
  }

  /**
   * Creates a new service account in the OpenAI project
   *
   * @param projectId - The OpenAI project ID
   * @param name - Name for the service account (e.g., "interview-abc123")
   * @returns Result with service account ID and API key
   */
  async createServiceAccount(
    projectId: string,
    name: string
  ): Promise<CreateServiceAccountResult> {
    if (!this.adminKey) {
      return {
        success: false,
        error: 'OPENAI_ADMIN_KEY not configured',
      }
    }

    try {
      logger.info(`Creating OpenAI service account: ${name}`)

      const response = await fetch(
        `${this.baseUrl}/organization/projects/${projectId}/service_accounts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.adminKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`OpenAI API error: ${response.status} - ${errorText}`)
        return {
          success: false,
          error: `OpenAI API error: ${response.status}`,
        }
      }

      const data: OpenAIServiceAccountResponse = await response.json()

      logger.info(`Service account created: ${data.id}`)

      return {
        success: true,
        serviceAccountId: data.id,
        apiKey: data.api_key.value,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to create service account: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  /**
   * Deletes a service account from the OpenAI project
   *
   * @param projectId - The OpenAI project ID
   * @param serviceAccountId - The service account ID to delete
   * @returns Result indicating success or failure
   */
  async deleteServiceAccount(
    projectId: string,
    serviceAccountId: string
  ): Promise<DeleteServiceAccountResult> {
    if (!this.adminKey) {
      return {
        success: false,
        error: 'OPENAI_ADMIN_KEY not configured',
      }
    }

    try {
      logger.info(`Deleting OpenAI service account: ${serviceAccountId}`)

      const response = await fetch(
        `${this.baseUrl}/organization/projects/${projectId}/service_accounts/${serviceAccountId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.adminKey}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`OpenAI API error: ${response.status} - ${errorText}`)
        return {
          success: false,
          error: `OpenAI API error: ${response.status}`,
        }
      }

      const data: OpenAIDeleteResponse = await response.json()

      logger.info(`Service account deleted: ${data.id}`)

      return {
        success: true,
        deleted: data.deleted,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to delete service account: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  /**
   * Lists all service accounts in the OpenAI project
   *
   * @param projectId - The OpenAI project ID
   * @returns Result with list of service accounts
   */
  async listServiceAccounts(
    projectId: string
  ): Promise<ListServiceAccountsResult> {
    if (!this.adminKey) {
      return {
        success: false,
        error: 'OPENAI_ADMIN_KEY not configured',
      }
    }

    try {
      logger.info('Listing OpenAI service accounts')

      const response = await fetch(
        `${this.baseUrl}/organization/projects/${projectId}/service_accounts?limit=100`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.adminKey}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`OpenAI API error: ${response.status} - ${errorText}`)
        return {
          success: false,
          error: `OpenAI API error: ${response.status}`,
        }
      }

      const data = await response.json()

      logger.info(`Found ${data.data?.length || 0} service accounts`)

      return {
        success: true,
        accounts: data.data || [],
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to list service accounts: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }
  }
}

export const openaiService = new OpenAIService()
