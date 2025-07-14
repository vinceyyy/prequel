import { terraformManager } from '../terraform'

// Mock fetch globally
global.fetch = jest.fn()

describe('TerraformManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('waitForServiceHealth', () => {
    it('should return success when service responds with 200', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      const result = await terraformManager['waitForServiceHealth'](
        'https://test.example.com',
        30000, // 30 second timeout for test
        jest.fn()
      )

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'User-Agent': 'Prequel-Portal-HealthCheck/1.0',
          },
        })
      )
    })

    it('should handle non-200 responses', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      } as Response)

      const onData = jest.fn()
      const result = await terraformManager['waitForServiceHealth'](
        'https://test.example.com',
        5000, // Very short timeout for test
        onData
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Service health check failed')
    })
  })

  describe('retryHealthCheck', () => {
    it('should get interview status and retry health check with successful response', async () => {
      // Mock getInterviewStatus to return success with access URL
      const mockGetInterviewStatus = jest.spyOn(
        terraformManager,
        'getInterviewStatus'
      )
      mockGetInterviewStatus.mockResolvedValue({
        success: true,
        output: '',
        outputs: {
          access_url: { value: 'https://interview.example.com' },
        },
      })

      // Mock fetch to return successful response
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      const result =
        await terraformManager.retryHealthCheck('test-interview-123')

      expect(result.success).toBe(true)
      expect(result.accessUrl).toBe('https://interview.example.com')
      expect(mockGetInterviewStatus).toHaveBeenCalledWith('test-interview-123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://interview.example.com',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'User-Agent': 'Prequel-Portal-HealthCheck/1.0',
          },
        })
      )
    })

    it('should handle missing interview status', async () => {
      const mockGetInterviewStatus = jest.spyOn(
        terraformManager,
        'getInterviewStatus'
      )
      mockGetInterviewStatus.mockResolvedValue({
        success: false,
        output: '',
        error: 'Interview not found',
      })

      const result =
        await terraformManager.retryHealthCheck('test-interview-123')

      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Could not get interview status for health check retry'
      )
    })

    it('should handle missing access URL', async () => {
      const mockGetInterviewStatus = jest.spyOn(
        terraformManager,
        'getInterviewStatus'
      )
      mockGetInterviewStatus.mockResolvedValue({
        success: true,
        output: '',
        outputs: {
          // No access_url in outputs
        },
      })

      const result =
        await terraformManager.retryHealthCheck('test-interview-123')

      expect(result.success).toBe(false)
      expect(result.error).toBe('No access URL found for health check retry')
    })
  })
})
