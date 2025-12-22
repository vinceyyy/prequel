import { openaiService } from '../openai'

// Mock the config module
jest.mock('../config', () => ({
  config: {
    services: {
      openaiAdminKey: 'sk-admin-test-key',
      openaiProjectId: 'proj_test123',
    },
  },
}))

// Mock the logger module
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('OpenAI Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks()
  })

  describe('createServiceAccount', () => {
    it('should create a service account with the correct project ID and name', async () => {
      const projectId = 'proj_test123'
      const accountName = 'interview-abc123'

      // Mock successful fetch response
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'organization.project.service_account',
          id: 'svc_acct_test123',
          name: accountName,
          role: 'member',
          created_at: Date.now() / 1000,
          api_key: {
            object: 'organization.project.service_account.api_key',
            value: 'sk-test123456789',
            name: 'Secret Key',
            created_at: Date.now() / 1000,
            id: 'key_test',
          },
        }),
      })

      const result = await openaiService.createServiceAccount(
        projectId,
        accountName
      )

      expect(result.success).toBe(true)
      expect(result.serviceAccountId).toBeDefined()
      expect(result.apiKey).toBeDefined()
      expect(result.apiKey).toMatch(/^sk-/)
    })

    it('should return error when API call fails', async () => {
      // Mock failed fetch response
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      const result = await openaiService.createServiceAccount('invalid', 'test')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('deleteServiceAccount', () => {
    it('should delete a service account successfully', async () => {
      const projectId = 'proj_test123'
      const serviceAccountId = 'svc_acct_abc'

      // Mock successful delete response
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'organization.project.service_account.deleted',
          id: serviceAccountId,
          deleted: true,
        }),
      })

      const result = await openaiService.deleteServiceAccount(
        projectId,
        serviceAccountId
      )

      expect(result.success).toBe(true)
      expect(result.deleted).toBe(true)
    })

    it('should return error when deletion fails', async () => {
      // Mock failed delete response
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      })

      const result = await openaiService.deleteServiceAccount(
        'invalid',
        'invalid'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('listServiceAccounts', () => {
    it('should return list of service accounts', async () => {
      // Mock successful response
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'svc_123',
              name: 'test-account',
              role: 'member',
              created_at: 1234567890,
            },
          ],
        }),
      })

      const result = await openaiService.listServiceAccounts('proj_test')

      expect(result.success).toBe(true)
      expect(result.accounts).toHaveLength(1)
      expect(result.accounts?.[0].id).toBe('svc_123')
    })

    it('should return error when API call fails', async () => {
      // Mock failed fetch response
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      const result = await openaiService.listServiceAccounts('invalid')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle empty list response', async () => {
      // Mock empty list response
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [],
        }),
      })

      const result = await openaiService.listServiceAccounts('proj_test')

      expect(result.success).toBe(true)
      expect(result.accounts).toHaveLength(0)
    })
  })

  describe('Error handling', () => {
    it('should handle network errors gracefully', async () => {
      // Mock network error
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'))

      const result = await openaiService.createServiceAccount(
        'proj_test',
        'test'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })

    it('should handle 401 unauthorized errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      const result = await openaiService.createServiceAccount(
        'proj_test',
        'test'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('401')
    })

    it('should handle 429 rate limiting errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      })

      const result = await openaiService.createServiceAccount(
        'proj_test',
        'test'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('429')
    })

    it('should handle network errors during deletion', async () => {
      // Mock network error for deletion
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('Connection timeout'))

      const result = await openaiService.deleteServiceAccount(
        'proj_test',
        'svc_123'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection timeout')
    })

    it('should handle 404 not found errors during deletion', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Service account not found',
      })

      const result = await openaiService.deleteServiceAccount(
        'proj_test',
        'svc_invalid'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('404')
    })

    it('should handle malformed JSON responses', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      })

      const result = await openaiService.createServiceAccount(
        'proj_test',
        'test'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid JSON')
    })
  })
})
