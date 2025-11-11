// portal/src/app/api/takehomes/__tests__/route.test.ts
import { GET } from '../route'
import type { TakeHome } from '@/lib/types/assessment'

jest.mock('@/lib/assessments')

import { assessmentManager } from '@/lib/assessments'

const mockAssessmentManager = jest.mocked(assessmentManager)

describe('GET /api/takehomes', () => {
  const now = Math.floor(Date.now() / 1000)

  const createMockTakeHome = (
    id: string,
    overrides: Partial<TakeHome> = {}
  ): TakeHome => ({
    PK: `TAKEHOME#${id}`,
    SK: 'METADATA',
    sessionType: 'takehome',
    id,
    accessToken: `token-${id}`,
    availableFrom: now - 3600,
    availableUntil: now + 86400,
    isActivated: false,
    sessionStatus: 'available',
    createdAt: now,
    createdBy: 'admin',
    candidateName: `Candidate ${id}`,
    candidateEmail: `candidate${id}@example.com`,
    instanceStatus: 'pending',
    challengeId: 'challenge-123',
    resourceConfig: {
      cpu: 1024,
      memory: 2048,
      storage: 20,
    },
    ...overrides,
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('successfully returns list of all take-homes', async () => {
    const mockTakeHomes = [
      createMockTakeHome('takehome-1'),
      createMockTakeHome('takehome-2'),
      createMockTakeHome('takehome-3'),
    ]

    mockAssessmentManager.listTakeHomes = jest
      .fn()
      .mockResolvedValue(mockTakeHomes)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('takeHomes')
    expect(Array.isArray(data.takeHomes)).toBe(true)
    expect(data.takeHomes).toHaveLength(3)
    expect(mockAssessmentManager.listTakeHomes).toHaveBeenCalledTimes(1)
  })

  test('returns take-homes sorted by createdAt descending (newest first)', async () => {
    const mockTakeHomes = [
      createMockTakeHome('takehome-1', { createdAt: now - 7200 }), // 2 hours ago
      createMockTakeHome('takehome-2', { createdAt: now - 3600 }), // 1 hour ago
      createMockTakeHome('takehome-3', { createdAt: now }), // now
    ]

    // Mock returns already sorted (AssessmentManager does the sorting)
    mockAssessmentManager.listTakeHomes = jest
      .fn()
      .mockResolvedValue([...mockTakeHomes].reverse())

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.takeHomes).toHaveLength(3)

    // Verify newest first
    const timestamps = data.takeHomes.map((th: { createdAt: string }) =>
      new Date(th.createdAt).getTime()
    )
    for (let i = 0; i < timestamps.length - 1; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1])
    }
  })

  test('returns empty array when no take-homes exist', async () => {
    mockAssessmentManager.listTakeHomes = jest.fn().mockResolvedValue([])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('takeHomes')
    expect(data.takeHomes).toEqual([])
    expect(mockAssessmentManager.listTakeHomes).toHaveBeenCalledTimes(1)
  })

  test('includes all necessary fields for each take-home', async () => {
    const mockTakeHome = createMockTakeHome('takehome-1', {
      sessionStatus: 'activated',
      instanceStatus: 'active',
      activatedAt: now - 600,
      autoDestroyAt: now + 3000,
      url: 'https://example.com',
      password: 'test-password',
    })

    mockAssessmentManager.listTakeHomes = jest
      .fn()
      .mockResolvedValue([mockTakeHome])

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.takeHomes).toHaveLength(1)

    const takeHome = data.takeHomes[0]
    expect(takeHome).toHaveProperty('id', 'takehome-1')
    expect(takeHome).toHaveProperty('candidateName', 'Candidate takehome-1')
    expect(takeHome).toHaveProperty(
      'candidateEmail',
      'candidatetakehome-1@example.com'
    )
    expect(takeHome).toHaveProperty('challengeId', 'challenge-123')
    expect(takeHome).toHaveProperty('sessionStatus', 'activated')
    expect(takeHome).toHaveProperty('instanceStatus', 'active')
    expect(takeHome).toHaveProperty('createdAt')
    expect(takeHome).toHaveProperty('availableFrom')
    expect(takeHome).toHaveProperty('availableUntil')
    expect(takeHome).toHaveProperty('activatedAt')
    expect(takeHome).toHaveProperty('accessToken', 'token-takehome-1')

    // Verify timestamps are ISO8601 strings
    expect(() => new Date(takeHome.createdAt)).not.toThrow()
    expect(() => new Date(takeHome.availableFrom)).not.toThrow()
    expect(() => new Date(takeHome.availableUntil)).not.toThrow()
    expect(() => new Date(takeHome.activatedAt)).not.toThrow()
  })

  test('handles different session statuses correctly', async () => {
    const mockTakeHomes = [
      createMockTakeHome('takehome-1', { sessionStatus: 'available' }),
      createMockTakeHome('takehome-2', {
        sessionStatus: 'activated',
        isActivated: true,
        activatedAt: now - 600,
      }),
      createMockTakeHome('takehome-3', {
        sessionStatus: 'completed',
        isActivated: true,
        activatedAt: now - 7200,
        destroyedAt: now - 3600,
      }),
      createMockTakeHome('takehome-4', {
        sessionStatus: 'expired',
        availableUntil: now - 86400,
      }),
    ]

    mockAssessmentManager.listTakeHomes = jest
      .fn()
      .mockResolvedValue(mockTakeHomes)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.takeHomes).toHaveLength(4)

    const statuses = data.takeHomes.map(
      (th: { sessionStatus: string }) => th.sessionStatus
    )
    expect(statuses).toContain('available')
    expect(statuses).toContain('activated')
    expect(statuses).toContain('completed')
    expect(statuses).toContain('expired')
  })

  test('returns 500 on database error', async () => {
    mockAssessmentManager.listTakeHomes = jest
      .fn()
      .mockRejectedValue(new Error('Database error'))

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('Failed to list take-homes')
    expect(mockAssessmentManager.listTakeHomes).toHaveBeenCalledTimes(1)
  })
})
