// Mock takehomeManager before importing the route
jest.mock('@/lib/takehome', () => ({
  takehomeManager: {
    createTakehome: jest.fn(),
    getActiveTakehomes: jest.fn(),
  },
}))

import { POST } from '../route'
import { NextRequest } from 'next/server'
import { takehomeManager } from '@/lib/takehome'

const mockTakehomeManager = jest.mocked(takehomeManager)

describe('POST /api/takehome', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should create take-home test and return passcode', async () => {
    const mockTakehome = {
      passcode: 'ABC12345',
      candidateName: 'John Doe',
      challenge: 'python',
      customInstructions: 'Complete the algorithm challenge',
      status: 'active' as const,
      validUntil: new Date('2025-01-13T00:00:00Z'),
      durationMinutes: 240,
      createdAt: new Date('2025-01-06T00:00:00Z'),
      ttl: 1234567890,
    }

    mockTakehomeManager.createTakehome.mockResolvedValue(mockTakehome)

    const request = new NextRequest('http://localhost:3000/api/takehome', {
      method: 'POST',
      body: JSON.stringify({
        candidateName: 'John Doe',
        challenge: 'python',
        customInstructions: 'Complete the algorithm challenge',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.passcode).toHaveLength(8)
    expect(data.url).toContain('/take-home/')
  })

  it('should require candidateName', async () => {
    const request = new NextRequest('http://localhost:3000/api/takehome', {
      method: 'POST',
      body: JSON.stringify({
        challenge: 'python',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
  })
})
