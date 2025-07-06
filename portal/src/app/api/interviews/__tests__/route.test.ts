import { NextRequest } from 'next/server'
import { GET, POST } from '../route'

// Mock the terraform and operations managers
jest.mock('@/lib/terraform', () => ({
  terraformManager: {
    listActiveInterviews: jest.fn(),
    getInterviewStatus: jest.fn(),
    createInterview: jest.fn(),
  },
}))

jest.mock('@/lib/operations', () => ({
  operationManager: {
    getAllOperations: jest.fn(),
  },
}))

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-12345678'),
}))

import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'

const mockTerraformManager = jest.mocked(terraformManager)
const mockOperationManager = jest.mocked(operationManager)

describe('/api/interviews', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET', () => {
    it('returns interviews from terraform and operations', async () => {
      mockOperationManager.getAllOperations.mockReturnValue([])
      mockTerraformManager.listActiveInterviews.mockResolvedValue([
        'int-1',
        'int-2',
      ])
      mockTerraformManager.getInterviewStatus.mockImplementation(
        (id: string) => {
          if (id === 'int-1') {
            return Promise.resolve({
              success: true,
              outputs: {
                candidate_name: { value: 'John Doe' },
                challenge: { value: 'javascript' },
                access_url: { value: 'https://example.com/int-1' },
                password: { value: 'test123' },
                created_at: { value: '2024-01-01T10:00:00Z' },
              },
            })
          }
          return Promise.resolve({ success: false })
        }
      )

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.interviews).toHaveLength(1)
      expect(data.interviews[0]).toMatchObject({
        id: 'int-1',
        candidateName: 'John Doe',
        challenge: 'javascript',
        status: 'active',
        accessUrl: 'https://example.com/int-1',
        password: 'test123',
      })
    })

    it('handles interviews from operations only', async () => {
      mockOperationManager.getAllOperations.mockReturnValue([
        {
          id: 'op-1',
          type: 'create',
          interviewId: 'int-1',
          candidateName: 'Jane Smith',
          challenge: 'python',
          status: 'completed',
          result: {
            success: true,
            accessUrl: 'https://example.com/int-1',
            password: 'pass123',
          },
          startedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ])
      mockTerraformManager.listActiveInterviews.mockResolvedValue([])

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.interviews).toHaveLength(1)
      expect(data.interviews[0]).toMatchObject({
        id: 'int-1',
        candidateName: 'Jane Smith',
        challenge: 'python',
        status: 'active',
        accessUrl: 'https://example.com/int-1',
        password: 'pass123',
      })
    })

    it('merges and deduplicates interviews from multiple sources', async () => {
      mockOperationManager.getAllOperations.mockReturnValue([
        {
          id: 'op-1',
          type: 'create',
          interviewId: 'int-1',
          candidateName: 'John Doe',
          challenge: 'javascript',
          status: 'completed',
          result: { success: true },
          startedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ])
      mockTerraformManager.listActiveInterviews.mockResolvedValue(['int-1'])
      mockTerraformManager.getInterviewStatus.mockResolvedValue({
        success: true,
        outputs: {
          candidate_name: { value: 'John Doe' },
          challenge: { value: 'javascript' },
          access_url: { value: 'https://example.com/int-1' },
          password: { value: 'test123' },
          created_at: { value: '2024-01-01T10:00:00Z' },
        },
      })

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.interviews).toHaveLength(1)
      expect(data.interviews[0].id).toBe('int-1')
      expect(data.interviews[0].status).toBe('active')
    })

    it('handles destroy operations correctly', async () => {
      mockOperationManager.getAllOperations.mockReturnValue([
        {
          id: 'op-1',
          type: 'create',
          interviewId: 'int-1',
          candidateName: 'John Doe',
          challenge: 'javascript',
          status: 'completed',
          result: { success: true },
          startedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'op-2',
          type: 'destroy',
          interviewId: 'int-1',
          status: 'running',
          startedAt: new Date('2024-01-01T11:00:00Z'),
        },
      ])
      mockTerraformManager.listActiveInterviews.mockResolvedValue([])

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.interviews).toHaveLength(1)
      expect(data.interviews[0].status).toBe('destroying')
    })

    it('filters out destroyed interviews', async () => {
      mockOperationManager.getAllOperations.mockReturnValue([
        {
          id: 'op-1',
          type: 'create',
          interviewId: 'int-1',
          candidateName: 'John Doe',
          challenge: 'javascript',
          status: 'completed',
          result: { success: true },
          startedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'op-2',
          type: 'destroy',
          interviewId: 'int-1',
          status: 'completed',
          result: { success: true },
          startedAt: new Date('2024-01-01T11:00:00Z'),
        },
      ])
      mockTerraformManager.listActiveInterviews.mockResolvedValue([])

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.interviews).toHaveLength(0)
    })

    it('handles terraform errors gracefully', async () => {
      mockOperationManager.getAllOperations.mockReturnValue([])
      mockTerraformManager.listActiveInterviews.mockRejectedValue(
        new Error('S3 error')
      )

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to list interviews')
      expect(data.details).toBe('S3 error')
    })
  })

  describe('POST', () => {
    it('creates interview successfully', async () => {
      mockTerraformManager.createInterview.mockResolvedValue({
        success: true,
        accessUrl: 'https://example.com/test-uuid-1',
        output: 'Terraform output',
        fullOutput: 'Full terraform output',
        executionLog: ['Log line 1', 'Log line 2'],
      })

      const request = new NextRequest('http://localhost:3000/api/interviews', {
        method: 'POST',
        body: JSON.stringify({
          candidateName: 'John Doe',
          challenge: 'javascript',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.interview).toMatchObject({
        id: 'test-uuid',
        candidateName: 'John Doe',
        challenge: 'javascript',
        status: 'active',
        accessUrl: 'https://example.com/test-uuid-1',
      })
      expect(data.interview.password).toBeDefined()
      expect(data.interview.createdAt).toBeDefined()
    })

    it('validates required fields', async () => {
      const request = new NextRequest('http://localhost:3000/api/interviews', {
        method: 'POST',
        body: JSON.stringify({
          candidateName: 'John Doe',
          // Missing challenge
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('candidateName and challenge are required')
    })

    it('handles terraform creation failure', async () => {
      mockTerraformManager.createInterview.mockResolvedValue({
        success: false,
        error: 'Terraform failed',
        output: 'Error output',
        fullOutput: 'Full error output',
        executionLog: ['Error log'],
      })

      const request = new NextRequest('http://localhost:3000/api/interviews', {
        method: 'POST',
        body: JSON.stringify({
          candidateName: 'John Doe',
          challenge: 'javascript',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create interview infrastructure')
      expect(data.details).toBe('Terraform failed')
    })

    it('handles invalid JSON body', async () => {
      const request = new NextRequest('http://localhost:3000/api/interviews', {
        method: 'POST',
        body: 'invalid json',
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create interview')
    })

    it('handles terraform manager exceptions', async () => {
      mockTerraformManager.createInterview.mockRejectedValue(
        new Error('Terraform crashed')
      )

      const request = new NextRequest('http://localhost:3000/api/interviews', {
        method: 'POST',
        body: JSON.stringify({
          candidateName: 'John Doe',
          challenge: 'javascript',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create interview')
      expect(data.details).toBe('Terraform crashed')
    })

    it('calls terraform manager with correct parameters', async () => {
      mockTerraformManager.createInterview.mockResolvedValue({
        success: true,
        accessUrl: 'https://example.com/test',
        output: '',
        fullOutput: '',
        executionLog: [],
      })

      const request = new NextRequest('http://localhost:3000/api/interviews', {
        method: 'POST',
        body: JSON.stringify({
          candidateName: 'Test User',
          challenge: 'python',
        }),
      })

      await POST(request)

      expect(mockTerraformManager.createInterview).toHaveBeenCalledWith({
        id: 'test-uuid',
        candidateName: 'Test User',
        challenge: 'python',
        password: expect.any(String),
      })
    })
  })
})
