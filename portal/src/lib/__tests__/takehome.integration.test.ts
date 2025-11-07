/**
 * Integration tests for TakehomeManager
 *
 * These tests verify the full lifecycle of take-home tests:
 * - Create, activate, complete, revoke operations
 * - Error handling for DynamoDB failures
 * - Edge cases like non-existent records
 */

import { marshall } from '@aws-sdk/util-dynamodb'

// Create mock function that will be properly initialized
const createMockSend = () => jest.fn()
const mockSend = createMockSend()

// Mock AWS SDK client
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb')
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      send: (...args: any[]) => mockSend(...args),
    })),
  }
})

// Mock config
jest.mock('../config', () => ({
  config: {
    aws: {
      getCredentials: jest.fn(() => ({
        region: 'us-east-1',
      })),
    },
    database: {
      takehomeTable: 'test-takehome-table',
    },
  },
}))

// Import after mocks are set up
import { TakehomeManager } from '../takehome'

describe('TakehomeManager Integration', () => {
  let manager: TakehomeManager

  beforeEach(() => {
    jest.clearAllMocks()
    mockSend.mockClear()
    manager = new TakehomeManager()
  })

  describe('full lifecycle', () => {
    it('should create, activate, and complete take-home test', async () => {
      // Mock createTakehome - PutItemCommand succeeds
      mockSend.mockResolvedValueOnce({})

      // Create
      const takehome = await manager.createTakehome({
        candidateName: 'Test Candidate',
        challenge: 'python',
        customInstructions: 'Complete the challenge',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      })

      expect(takehome.status).toBe('active')
      expect(takehome.passcode).toHaveLength(8)
      expect(takehome.candidateName).toBe('Test Candidate')
      expect(takehome.challenge).toBe('python')
      expect(takehome.customInstructions).toBe('Complete the challenge')
      expect(takehome.durationMinutes).toBe(240)

      // Verify PutItemCommand was called
      expect(mockSend).toHaveBeenCalledTimes(1)

      // Mock getTakehome - GetItemCommand returns the created item
      const mockItem = {
        passcode: takehome.passcode,
        candidateName: 'Test Candidate',
        challenge: 'python',
        customInstructions: 'Complete the challenge',
        status: 'active',
        validUntil:
          typeof takehome.validUntil === 'string'
            ? takehome.validUntil
            : takehome.validUntil.toISOString(),
        durationMinutes: 240,
        createdAt:
          typeof takehome.createdAt === 'string'
            ? takehome.createdAt
            : takehome.createdAt.toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      }

      mockSend.mockResolvedValueOnce({
        Item: marshall(mockItem),
      })

      // Get
      const retrieved = await manager.getTakehome(takehome.passcode)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.candidateName).toBe('Test Candidate')
      expect(retrieved?.status).toBe('active')

      // Mock activateTakehome - UpdateItemCommand succeeds
      mockSend.mockResolvedValueOnce({})

      // Activate
      const activated = await manager.activateTakehome(
        takehome.passcode,
        'test-interview-123'
      )
      expect(activated).toBe(true)

      // Mock getTakehome after activation
      const activatedItem = {
        ...mockItem,
        status: 'activated',
        interviewId: 'test-interview-123',
        activatedAt: new Date().toISOString(),
      }

      mockSend.mockResolvedValueOnce({
        Item: marshall(activatedItem),
      })

      const afterActivation = await manager.getTakehome(takehome.passcode)
      expect(afterActivation?.status).toBe('activated')
      expect(afterActivation?.interviewId).toBe('test-interview-123')
      expect(afterActivation?.activatedAt).toBeDefined()

      // Mock completeTakehome - UpdateItemCommand succeeds
      mockSend.mockResolvedValueOnce({})

      // Complete
      const completed = await manager.completeTakehome(takehome.passcode)
      expect(completed).toBe(true)

      // Mock getTakehome after completion
      const completedItem = {
        ...activatedItem,
        status: 'completed',
      }

      mockSend.mockResolvedValueOnce({
        Item: marshall(completedItem),
      })

      const afterCompletion = await manager.getTakehome(takehome.passcode)
      expect(afterCompletion?.status).toBe('completed')
    })

    it('should handle revocation', async () => {
      // Mock createTakehome
      mockSend.mockResolvedValueOnce({})

      const takehome = await manager.createTakehome({
        candidateName: 'Test Candidate',
        challenge: 'python',
        customInstructions: 'Test',
        availabilityWindowDays: 7,
        durationMinutes: 240,
      })

      // Mock revokeTakehome - UpdateItemCommand succeeds
      mockSend.mockResolvedValueOnce({})

      const revoked = await manager.revokeTakehome(takehome.passcode)
      expect(revoked).toBe(true)

      // Mock getTakehome after revocation
      const revokedItem = {
        passcode: takehome.passcode,
        candidateName: 'Test Candidate',
        challenge: 'python',
        customInstructions: 'Test',
        status: 'revoked',
        validUntil:
          typeof takehome.validUntil === 'string'
            ? takehome.validUntil
            : takehome.validUntil.toISOString(),
        durationMinutes: 240,
        createdAt:
          typeof takehome.createdAt === 'string'
            ? takehome.createdAt
            : takehome.createdAt.toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      }

      mockSend.mockResolvedValueOnce({
        Item: marshall(revokedItem),
      })

      const afterRevoke = await manager.getTakehome(takehome.passcode)
      expect(afterRevoke?.status).toBe('revoked')
    })

    it('should get active takehomes', async () => {
      // Mock getActiveTakehomes - QueryCommand returns multiple items
      const mockItems = [
        {
          passcode: 'ABC12345',
          candidateName: 'Candidate 1',
          challenge: 'python',
          customInstructions: 'Test 1',
          status: 'active',
          validUntil: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ).toISOString(),
          durationMinutes: 240,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 37 * 24 * 60 * 60,
        },
        {
          passcode: 'DEF67890',
          candidateName: 'Candidate 2',
          challenge: 'javascript',
          customInstructions: 'Test 2',
          status: 'active',
          validUntil: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ).toISOString(),
          durationMinutes: 180,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 37 * 24 * 60 * 60,
        },
      ]

      mockSend.mockResolvedValueOnce({
        Items: mockItems.map(item => marshall(item)),
      })

      const activeTakehomes = await manager.getActiveTakehomes()
      expect(activeTakehomes).toHaveLength(2)
      expect(activeTakehomes[0].candidateName).toBe('Candidate 1')
      expect(activeTakehomes[1].candidateName).toBe('Candidate 2')
      expect(activeTakehomes[0].status).toBe('active')
      expect(activeTakehomes[1].status).toBe('active')
    })

    it('should handle activation failure gracefully', async () => {
      // Mock activateTakehome - UpdateItemCommand fails
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'))

      const activated = await manager.activateTakehome(
        'INVALID123',
        'test-interview-456'
      )
      expect(activated).toBe(false)
    })

    it('should handle revocation failure gracefully', async () => {
      // Mock revokeTakehome - UpdateItemCommand fails
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'))

      const revoked = await manager.revokeTakehome('INVALID123')
      expect(revoked).toBe(false)
    })

    it('should handle completion failure gracefully', async () => {
      // Mock completeTakehome - UpdateItemCommand fails
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'))

      const completed = await manager.completeTakehome('INVALID123')
      expect(completed).toBe(false)
    })

    it('should return null for non-existent takehome', async () => {
      // Mock getTakehome - GetItemCommand returns no item
      mockSend.mockResolvedValueOnce({})

      const takehome = await manager.getTakehome('NOTFOUND1')
      expect(takehome).toBeNull()
    })

    it('should return empty array when no active takehomes exist', async () => {
      // Mock getActiveTakehomes - QueryCommand returns no items
      mockSend.mockResolvedValueOnce({})

      const activeTakehomes = await manager.getActiveTakehomes()
      expect(activeTakehomes).toEqual([])
    })
  })
})
