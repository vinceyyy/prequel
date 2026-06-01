// portal/src/lib/__tests__/assessments.test.ts
import type { Mock } from 'vitest'
import type { Interview, TakeHome } from '../types/assessment'

// Mock AWS SDK - create mock functions in factory
vi.mock('@aws-sdk/client-dynamodb', () => {
  const mockSend = vi.fn()
  return {
    DynamoDBClient: vi.fn().mockImplementation(function (this: { send: unknown }) {
      this.send = mockSend
    }),
    PutItemCommand: vi.fn(function (this: Record<string, unknown>, params) {
      Object.assign(this, params)
    }),
    GetItemCommand: vi.fn(function (this: Record<string, unknown>, params) {
      Object.assign(this, params)
    }),
    UpdateItemCommand: vi.fn(function (this: Record<string, unknown>, params) {
      Object.assign(this, params)
    }),
    QueryCommand: vi.fn(function (this: Record<string, unknown>, params) {
      Object.assign(this, params)
    }),
    __mockSend: mockSend, // Expose for test access
  }
})

vi.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: vi.fn((obj) => obj),
  unmarshall: vi.fn((obj) => obj),
}))

vi.mock('../config', () => ({
  config: {
    aws: { getCredentials: vi.fn(() => ({})), region: 'us-east-1' },
    database: { assessmentsTable: 'test-assessments' },
  },
}))

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { assessmentManager } from '../assessments'
import * as dynamodb from '@aws-sdk/client-dynamodb'

interface DynamoDBMock {
  __mockSend: Mock
}

describe('Assessment Manager', () => {
  const mockSend = (dynamodb as unknown as DynamoDBMock).__mockSend

  beforeEach(() => {
    mockSend.mockClear()
  })

  test('creates interview record in DynamoDB', async () => {
    mockSend.mockResolvedValueOnce({})

    const interview: Omit<Interview, 'createdAt'> = {
      PK: 'INTERVIEW#int-123',
      SK: 'METADATA',
      sessionType: 'interview',
      id: 'int-123',
      type: 'immediate',
      sessionStatus: 'active',
      createdBy: 'user-123',
      instanceStatus: 'pending',
      challengeId: 'challenge-123',
      resourceConfig: {
        cpu: 1024,
        memory: 2048,
        storage: 20,
      },
    }

    const created = await assessmentManager.createInterview(interview)

    expect(created.id).toBe('int-123')
    expect(created.sessionType).toBe('interview')
    expect(created.createdAt).toBeDefined()
  })

  test('creates take-home record in DynamoDB', async () => {
    mockSend.mockResolvedValueOnce({})

    const takeHome: Omit<TakeHome, 'createdAt'> = {
      PK: 'TAKEHOME#th-123',
      SK: 'METADATA',
      sessionType: 'takehome',
      id: 'th-123',
      accessToken: 'token-abc',
      availableFrom: Date.now() / 1000,
      availableUntil: Date.now() / 1000 + 86400 * 7,
      isActivated: false,
      sessionStatus: 'available',
      createdBy: 'user-123',
      durationHours: 4,
      instanceStatus: 'pending',
      challengeId: 'challenge-123',
      resourceConfig: {
        cpu: 1024,
        memory: 2048,
        storage: 20,
      },
    }

    const created = await assessmentManager.createTakeHome(takeHome)

    expect(created.id).toBe('th-123')
    expect(created.sessionType).toBe('takehome')
    expect(created.accessToken).toBe('token-abc')
  })

  test('retrieves assessment by ID', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'INTERVIEW#int-123',
        SK: 'METADATA',
        sessionType: 'interview',
        id: 'int-123',
      },
    })

    const assessment = await assessmentManager.getAssessment('int-123')

    expect(assessment).toBeDefined()
    if (assessment) {
      expect(assessment.id).toBe('int-123')
    }
  })

  test('updates instance status', async () => {
    mockSend.mockResolvedValueOnce({})
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'INTERVIEW#int-123',
        SK: 'METADATA',
        id: 'int-123',
        instanceStatus: 'active',
      },
    })

    await assessmentManager.updateInstanceStatus('int-123', 'interview', 'active')

    const updated = await assessmentManager.getAssessment('int-123')
    expect(updated?.instanceStatus).toBe('active')
  })

  test('updates session status', async () => {
    mockSend.mockResolvedValueOnce({})
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'INTERVIEW#int-123',
        SK: 'METADATA',
        sessionType: 'interview',
        id: 'int-123',
        sessionStatus: 'completed',
      },
    })

    await assessmentManager.updateSessionStatus('int-123', 'interview', 'completed')

    const updated = await assessmentManager.getAssessment('int-123')
    if (updated && updated.sessionType === 'interview') {
      expect(updated.sessionStatus).toBe('completed')
    }
  })
})
