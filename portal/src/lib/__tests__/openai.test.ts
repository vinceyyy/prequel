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
})
