// portal/src/app/api/takehome/[token]/__tests__/route.test.ts
import { GET } from '../route'
import { NextRequest } from 'next/server'
import type { TakeHome } from '@/lib/types/assessment'

jest.mock('@/lib/assessments')

import { assessmentManager } from '@/lib/assessments'

const mockAssessmentManager = jest.mocked(assessmentManager)

describe('GET /api/takehome/[token]', () => {
  const mockToken = 'test-token-123'
  const now = Math.floor(Date.now() / 1000)

  const baseTakeHome: TakeHome = {
    PK: 'TAKEHOME#takehome-123',
    SK: 'METADATA',
    sessionType: 'takehome',
    id: 'takehome-123',
    accessToken: mockToken,
    availableFrom: now - 3600, // 1 hour ago
    availableUntil: now + 86400, // 1 day from now
    isActivated: false,
    sessionStatus: 'available',
    createdAt: now - 3600,
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
  })

  test('successfully returns status for available take-home', async () => {
    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(baseTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}`,
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ token: mockToken }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      sessionStatus: 'available',
      availableFrom: new Date(baseTakeHome.availableFrom * 1000).toISOString(),
      availableUntil: new Date(
        baseTakeHome.availableUntil * 1000
      ).toISOString(),
      candidateName: 'Jane Doe',
      challengeId: 'challenge-123',
    })
    expect(mockAssessmentManager.getTakeHomeByToken).toHaveBeenCalledWith(
      mockToken
    )
  })

  test('successfully returns status for activated take-home with active instance', async () => {
    const activatedTakeHome: TakeHome = {
      ...baseTakeHome,
      sessionStatus: 'activated',
      isActivated: true,
      instanceStatus: 'active',
      activatedAt: now - 600, // 10 minutes ago
      autoDestroyAt: now + 3000, // 50 minutes from now
      url: 'https://example.com',
      password: 'test-password',
    }

    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(activatedTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}`,
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ token: mockToken }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      sessionStatus: 'activated',
      instanceStatus: 'active',
      accessUrl: 'https://example.com',
      password: 'test-password',
      activatedAt: new Date(
        activatedTakeHome.activatedAt! * 1000
      ).toISOString(),
      autoDestroyAt: new Date(
        activatedTakeHome.autoDestroyAt! * 1000
      ).toISOString(),
      timeRemaining: 3000,
    })
  })

  test('successfully returns status for activated take-home with initializing instance', async () => {
    const activatedTakeHome: TakeHome = {
      ...baseTakeHome,
      sessionStatus: 'activated',
      isActivated: true,
      instanceStatus: 'initializing',
      activatedAt: now - 300, // 5 minutes ago
      autoDestroyAt: now + 3300, // 55 minutes from now
    }

    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(activatedTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}`,
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ token: mockToken }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      sessionStatus: 'activated',
      instanceStatus: 'initializing',
      activatedAt: new Date(
        activatedTakeHome.activatedAt! * 1000
      ).toISOString(),
      autoDestroyAt: new Date(
        activatedTakeHome.autoDestroyAt! * 1000
      ).toISOString(),
      timeRemaining: 3300,
    })
    expect(data.accessUrl).toBeUndefined()
    expect(data.password).toBeUndefined()
  })

  test('successfully returns status for completed take-home', async () => {
    const completedTakeHome: TakeHome = {
      ...baseTakeHome,
      sessionStatus: 'completed',
      isActivated: true,
      instanceStatus: 'destroyed',
      activatedAt: now - 7200, // 2 hours ago
      autoDestroyAt: now - 3600, // destroyed 1 hour ago
      destroyedAt: now - 3600,
    }

    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(completedTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}`,
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ token: mockToken }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      sessionStatus: 'completed',
      instanceStatus: 'destroyed',
      activatedAt: new Date(
        completedTakeHome.activatedAt! * 1000
      ).toISOString(),
      destroyedAt: new Date(
        completedTakeHome.destroyedAt! * 1000
      ).toISOString(),
    })
  })

  test('successfully returns status for expired take-home', async () => {
    const expiredTakeHome: TakeHome = {
      ...baseTakeHome,
      sessionStatus: 'expired',
      availableUntil: now - 86400, // expired 1 day ago
    }

    mockAssessmentManager.getTakeHomeByToken = jest
      .fn()
      .mockResolvedValue(expiredTakeHome)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}`,
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ token: mockToken }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      sessionStatus: 'expired',
      availableFrom: new Date(
        expiredTakeHome.availableFrom * 1000
      ).toISOString(),
      availableUntil: new Date(
        expiredTakeHome.availableUntil * 1000
      ).toISOString(),
    })
  })

  test('returns 404 for non-existent token', async () => {
    mockAssessmentManager.getTakeHomeByToken = jest.fn().mockResolvedValue(null)

    const request = new NextRequest(
      `http://localhost/api/takehomes/${mockToken}`,
      {
        method: 'GET',
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ token: mockToken }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toContain('not found')
    expect(mockAssessmentManager.getTakeHomeByToken).toHaveBeenCalledWith(
      mockToken
    )
  })
})
