// portal/src/lib/__tests__/assessments.test.ts
import type { Interview, TakeHome } from '../types/assessment'

// Mock AWS SDK - create mock functions in factory
jest.mock('@aws-sdk/client-dynamodb', () => {
  const mockSend = jest.fn()
  return {
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    PutItemCommand: jest.fn(params => params),
    GetItemCommand: jest.fn(params => params),
    UpdateItemCommand: jest.fn(params => params),
    QueryCommand: jest.fn(params => params),
    __mockSend: mockSend, // Expose for test access
  }
})

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn(obj => obj),
  unmarshall: jest.fn(obj => obj),
}))

jest.mock('../config', () => ({
  config: {
    aws: { getCredentials: jest.fn(() => ({})), region: 'us-east-1' },
    database: { assessmentsTable: 'test-assessments' },
  },
}))

jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { assessmentManager } from '../assessments'
import * as dynamodb from '@aws-sdk/client-dynamodb'

interface DynamoDBMock {
  __mockSend: jest.Mock
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

    await assessmentManager.updateInstanceStatus(
      'int-123',
      'interview',
      'active'
    )

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

    await assessmentManager.updateSessionStatus(
      'int-123',
      'interview',
      'completed'
    )

    const updated = await assessmentManager.getAssessment('int-123')
    if (updated && updated.sessionType === 'interview') {
      expect(updated.sessionStatus).toBe('completed')
    }
  })
})
