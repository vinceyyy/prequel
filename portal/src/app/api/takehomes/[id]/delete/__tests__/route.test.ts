// portal/src/app/api/takehomes/[id]/delete/__tests__/route.test.ts
import { POST } from '../route'
import { NextRequest } from 'next/server'
import type { TakeHome } from '@/lib/types/assessment'

jest.mock('@/lib/assessments')
jest.mock('@/lib/operations')
jest.mock('@/lib/instance')
jest.mock('@/lib/openai')

import { assessmentManager } from '@/lib/assessments'
import { operationManager } from '@/lib/operations'
import { destroyInstance } from '@/lib/instance'
import { openaiService } from '@/lib/openai'

const mockAssessmentManager = jest.mocked(assessmentManager)
const mockOperationManager = jest.mocked(operationManager)
const mockDestroyInstance = jest.mocked(destroyInstance)
const mockOpenaiService = jest.mocked(openaiService)

describe('POST /api/takehomes/[id]/delete', () => {
  const mockTakeHomeId = 'takehome-123'

  beforeEach(() => {
    jest.clearAllMocks()
    mockOperationManager.createOperation = jest
      .fn()
      .mockResolvedValue('operation-123')
    mockDestroyInstance.mockResolvedValue({
      success: true,
      historyS3Key: 's3://bucket/history/key',
    })
    mockOpenaiService.deleteServiceAccount = jest.fn().mockResolvedValue({
      success: true,
    })
  })

  describe('Available take-home (no infrastructure)', () => {
    test('successfully deletes available take-home', async () => {
      const availableTakeHome: TakeHome = {
        PK: `TAKEHOME#${mockTakeHomeId}`,
        SK: 'METADATA',
        sessionType: 'takehome',
        id: mockTakeHomeId,
        accessToken: 'token-123',
        availableFrom: Math.floor(Date.now() / 1000) - 3600,
        availableUntil: Math.floor(Date.now() / 1000) + 86400,
        isActivated: false,
        sessionStatus: 'available',
        createdAt: Math.floor(Date.now() / 1000) - 3600,
        createdBy: 'admin',
        candidateName: 'Jane Doe',
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockAssessmentManager.getAssessment = jest
        .fn()
        .mockResolvedValue(availableTakeHome)
      mockAssessmentManager.deleteTakeHome = jest
        .fn()
        .mockResolvedValue(undefined)

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toContain('deleted successfully')
      expect(mockAssessmentManager.deleteTakeHome).toHaveBeenCalledWith(
        mockTakeHomeId
      )
      expect(mockOperationManager.createOperation).not.toHaveBeenCalled()
      expect(mockDestroyInstance).not.toHaveBeenCalled()
    })

    test('successfully deletes expired take-home', async () => {
      const expiredTakeHome: TakeHome = {
        PK: `TAKEHOME#${mockTakeHomeId}`,
        SK: 'METADATA',
        sessionType: 'takehome',
        id: mockTakeHomeId,
        accessToken: 'token-123',
        availableFrom: Math.floor(Date.now() / 1000) - 86400 * 8,
        availableUntil: Math.floor(Date.now() / 1000) - 86400,
        isActivated: false,
        sessionStatus: 'expired',
        createdAt: Math.floor(Date.now() / 1000) - 86400 * 8,
        createdBy: 'admin',
        candidateName: 'Jane Doe',
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockAssessmentManager.getAssessment = jest
        .fn()
        .mockResolvedValue(expiredTakeHome)
      mockAssessmentManager.deleteTakeHome = jest
        .fn()
        .mockResolvedValue(undefined)

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockAssessmentManager.deleteTakeHome).toHaveBeenCalledWith(
        mockTakeHomeId
      )
      expect(mockDestroyInstance).not.toHaveBeenCalled()
    })

    test('deletes OpenAI service account for available take-home', async () => {
      const availableTakeHomeWithOpenAI: TakeHome = {
        PK: `TAKEHOME#${mockTakeHomeId}`,
        SK: 'METADATA',
        sessionType: 'takehome',
        id: mockTakeHomeId,
        accessToken: 'token-123',
        availableFrom: Math.floor(Date.now() / 1000) - 3600,
        availableUntil: Math.floor(Date.now() / 1000) + 86400,
        isActivated: false,
        sessionStatus: 'available',
        createdAt: Math.floor(Date.now() / 1000) - 3600,
        createdBy: 'admin',
        candidateName: 'Jane Doe',
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
        openaiServiceAccount: {
          apiKey: 'sk-proj-123',
          projectId: 'proj-123',
          serviceAccountId: 'sa-123',
        },
      }

      mockAssessmentManager.getAssessment = jest
        .fn()
        .mockResolvedValue(availableTakeHomeWithOpenAI)
      mockAssessmentManager.deleteTakeHome = jest
        .fn()
        .mockResolvedValue(undefined)

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockOpenaiService.deleteServiceAccount).toHaveBeenCalledWith(
        'proj-123',
        'sa-123'
      )
      expect(mockAssessmentManager.deleteTakeHome).toHaveBeenCalledWith(
        mockTakeHomeId
      )
    })
  })

  describe('Activated take-home (has infrastructure)', () => {
    test('successfully initiates destruction for activated take-home', async () => {
      const activatedTakeHome: TakeHome = {
        PK: `TAKEHOME#${mockTakeHomeId}`,
        SK: 'METADATA',
        sessionType: 'takehome',
        id: mockTakeHomeId,
        accessToken: 'token-123',
        availableFrom: Math.floor(Date.now() / 1000) - 3600,
        availableUntil: Math.floor(Date.now() / 1000) + 86400,
        isActivated: true,
        activatedAt: Math.floor(Date.now() / 1000) - 1800,
        sessionStatus: 'activated',
        createdAt: Math.floor(Date.now() / 1000) - 3600,
        createdBy: 'admin',
        candidateName: 'Jane Doe',
        instanceStatus: 'active',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
        url: 'https://example.com',
        password: 'test-password',
      }

      mockAssessmentManager.getAssessment = jest
        .fn()
        .mockResolvedValue(activatedTakeHome)
      mockOperationManager.updateOperationStatus = jest
        .fn()
        .mockResolvedValue(undefined)
      mockOperationManager.addOperationLog = jest
        .fn()
        .mockResolvedValue(undefined)
      mockOperationManager.setOperationResult = jest
        .fn()
        .mockResolvedValue(undefined)

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.operationId).toBe('operation-123')
      expect(data.message).toContain('Destruction initiated')
      expect(mockOperationManager.createOperation).toHaveBeenCalledWith(
        'destroy',
        mockTakeHomeId,
        'Jane Doe',
        'challenge-123'
      )
      expect(mockAssessmentManager.deleteTakeHome).not.toHaveBeenCalled()
    })
  })

  describe('Error cases', () => {
    test('returns 404 for non-existent take-home', async () => {
      mockAssessmentManager.getAssessment = jest.fn().mockResolvedValue(null)

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toContain('not found')
      expect(mockAssessmentManager.deleteTakeHome).not.toHaveBeenCalled()
      expect(mockOperationManager.createOperation).not.toHaveBeenCalled()
    })

    test('returns 400 for interview (not take-home)', async () => {
      const interview = {
        PK: 'INTERVIEW#interview-123',
        SK: 'METADATA',
        sessionType: 'interview' as const,
        id: 'interview-123',
        type: 'immediate' as const,
        sessionStatus: 'active' as const,
        instanceStatus: 'active' as const,
        createdAt: Math.floor(Date.now() / 1000),
        createdBy: 'admin',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockAssessmentManager.getAssessment = jest
        .fn()
        .mockResolvedValue(interview)

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('not a take-home')
      expect(mockAssessmentManager.deleteTakeHome).not.toHaveBeenCalled()
      expect(mockOperationManager.createOperation).not.toHaveBeenCalled()
    })

    test('handles deletion errors gracefully', async () => {
      const availableTakeHome: TakeHome = {
        PK: `TAKEHOME#${mockTakeHomeId}`,
        SK: 'METADATA',
        sessionType: 'takehome',
        id: mockTakeHomeId,
        accessToken: 'token-123',
        availableFrom: Math.floor(Date.now() / 1000) - 3600,
        availableUntil: Math.floor(Date.now() / 1000) + 86400,
        isActivated: false,
        sessionStatus: 'available',
        createdAt: Math.floor(Date.now() / 1000) - 3600,
        createdBy: 'admin',
        candidateName: 'Jane Doe',
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockAssessmentManager.getAssessment = jest
        .fn()
        .mockResolvedValue(availableTakeHome)
      mockAssessmentManager.deleteTakeHome = jest
        .fn()
        .mockRejectedValue(new Error('DynamoDB error'))

      const request = new NextRequest(
        `http://localhost/api/takehomes/${mockTakeHomeId}/delete`,
        {
          method: 'POST',
        }
      )

      const response = await POST(request, {
        params: Promise.resolve({ id: mockTakeHomeId }),
      })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toContain('Failed to delete take-home')
      expect(data.details).toBe('DynamoDB error')
    })
  })
})
