// portal/src/app/api/takehomes/create/__tests__/route.test.ts
import { POST } from '../route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/assessments')
jest.mock('@/lib/openai')

import { assessmentManager } from '@/lib/assessments'
import { openaiService } from '@/lib/openai'

const mockAssessmentManager = jest.mocked(assessmentManager)
const mockOpenaiService = jest.mocked(openaiService)

describe('POST /api/takehomes/create', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAssessmentManager.createTakeHome = jest
      .fn()
      .mockResolvedValue(undefined)
    mockOpenaiService.createServiceAccount = jest.fn().mockResolvedValue({
      success: true,
      apiKey: 'test-key',
      serviceAccountId: 'sa-test-123',
    })
  })

  test('creates take-home with generated token', async () => {
    const request = new NextRequest('http://localhost/api/takehomes/create', {
      method: 'POST',
      body: JSON.stringify({
        candidateName: 'Jane Doe',
        candidateEmail: 'jane@example.com',
        challengeId: 'challenge-123',
        availableDays: 7,
        durationHours: 4,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.takeHomeId).toBeDefined()
    expect(data.accessToken).toBeDefined()
    expect(data.accessUrl).toContain('/takehome/')
    expect(mockAssessmentManager.createTakeHome).toHaveBeenCalled()
  })

  test('returns 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost/api/takehomes/create', {
      method: 'POST',
      body: JSON.stringify({
        candidateName: 'Jane Doe',
        // Missing challengeId
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mockAssessmentManager.createTakeHome).not.toHaveBeenCalled()
  })
})
