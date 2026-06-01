// portal/src/lib/__tests__/instance.test.ts
import { provisionInstance, destroyInstance } from '../instance'
import { terraformManager } from '../terraform'

// Mock dependencies
jest.mock('../terraform')
jest.mock('../openai')
jest.mock('../config', () => ({
  config: {
    aws: {
      getCredentials: jest.fn(),
      region: 'us-east-1',
    },
    database: {
      interviewsTable: 'test-interviews',
    },
  },
}))

describe('Instance Management', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('provisionInstance creates infrastructure and returns result', async () => {
    const mockTerraformResult = {
      success: true,
      accessUrl: 'https://test.example.com',
      healthCheckPassed: true,
      infrastructureReady: true,
    }

    ;(terraformManager.createInterviewStreaming as jest.Mock).mockResolvedValue(
      mockTerraformResult
    )

    const result = await provisionInstance({
      instanceId: 'test-123',
      challengeId: 'challenge-123',
      password: 'test-password',
      autoDestroyAt: Date.now() + 3600000,
      resourceConfig: {
        cpu: 1024,
        memory: 2048,
        storage: 20,
      },
    })

    expect(result.success).toBe(true)
    expect(result.accessUrl).toBe('https://test.example.com')
    expect(terraformManager.createInterviewStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-123',
        challenge: 'challenge-123',
        password: 'test-password',
      }),
      undefined,
      undefined
    )
  })

  test('destroyInstance tears down infrastructure', async () => {
    const mockTerraformResult = {
      success: true,
      historyS3Key: 'history/test-123.tar.gz',
    }

    ;(
      terraformManager.destroyInterviewStreaming as jest.Mock
    ).mockResolvedValue(mockTerraformResult)

    const result = await destroyInstance('test-123', {
      saveFiles: true,
      candidateName: 'Test User',
      challenge: 'challenge-123',
    })

    expect(result.success).toBe(true)
    expect(result.historyS3Key).toBe('history/test-123.tar.gz')
  })
})
