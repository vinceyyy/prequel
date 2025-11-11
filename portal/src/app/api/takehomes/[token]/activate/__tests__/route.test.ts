// portal/src/app/api/takehomes/[token]/activate/__tests__/route.test.ts
import { POST } from '../route'
import { NextRequest } from 'next/server'
import type { TakeHome } from '@/lib/types/assessment'

jest.mock('@/lib/assessments')
jest.mock('@/lib/operations')
jest.mock('@/lib/instance')

import { assessmentManager } from '@/lib/assessments'
import { operationManager } from '@/lib/operations'
import { provisionInstance } from '@/lib/instance'

const mockAssessmentManager = jest.mocked(assessmentManager)
const mockOperationManager = jest.mocked(operationManager)
const mockProvisionInstance = jest.mocked(provisionInstance)

describe('POST /api/takehomes/[token]/activate', () => {
  const mockToken = 'test-token-123'
  const mockTakeHome: TakeHome = {
    PK: 'TAKEHOME#takehome-123',
    SK: 'METADATA',
    sessionType: 'takehome',
    id: 'takehome-123',
    accessToken: mockToken,
    availableFrom: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    availableUntil: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
    isActivated: false,
    sessionStatus: 'available',
    createdAt: Math.floor(Date.now() / 1000) - 3600,
    createdBy: 'admin',
    candidateName: 'Jane Doe',
    candidateEmail: 'jane@example.com',
    instanceStatus: 'pending',
    challengeId: 'challenge-123',
    resourceConfig: {
      cpu: 1024,
      memory: 2048,
      storage: 20,
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockOperationManager.createOperation = jest
      .fn()
      .mockResolvedValue('operation-123')
    mockProvisionInstance.mockResolvedValue({
      success: true,
      accessUrl: 'https://example.com',
    })
  })

  test('successfully activates available take-home', async () => {
    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(mockTakeHome)
    mockAssessmentManager.updateSessionStatus = jest
      .fn()
      .mockResolvedValue(undefined)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}/activate`,
      {
        method: 'POST',
      }
    )

    const response = await POST(request, { params: { token: mockToken } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.operationId).toBe('operation-123')
    expect(mockAssessmentManager.getTakeHomeByToken).toHaveBeenCalledWith(
      mockToken
    )
    expect(mockOperationManager.createOperation).toHaveBeenCalledWith(
      'create',
      'takehome-123',
      'Jane Doe',
      'challenge-123',
      undefined,
      expect.any(Date),
      false
    )
    expect(mockAssessmentManager.updateSessionStatus).toHaveBeenCalledWith(
      'takehome-123',
      'takehome',
      'activated'
    )
  })

  test('returns 404 for non-existent token', async () => {
    mockAssessmentManager.getTakeHomeByToken = jest.fn().mockResolvedValue(null)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}/activate`,
      {
        method: 'POST',
      }
    )

    const response = await POST(request, { params: { token: mockToken } })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toContain('not found')
    expect(mockOperationManager.createOperation).not.toHaveBeenCalled()
  })

  test('returns 400 for already activated take-home', async () => {
    const activatedTakeHome = {
      ...mockTakeHome,
      sessionStatus: 'activated' as const,
      isActivated: true,
    }
    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(activatedTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}/activate`,
      {
        method: 'POST',
      }
    )

    const response = await POST(request, { params: { token: mockToken } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('already activated')
    expect(mockOperationManager.createOperation).not.toHaveBeenCalled()
  })

  test('returns 400 for expired take-home', async () => {
    const expiredTakeHome = {
      ...mockTakeHome,
      availableUntil: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    }
    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(expiredTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}/activate`,
      {
        method: 'POST',
      }
    )

    const response = await POST(request, { params: { token: mockToken } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('expired')
    expect(mockOperationManager.createOperation).not.toHaveBeenCalled()
  })
})
