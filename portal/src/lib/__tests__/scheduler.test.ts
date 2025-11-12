// portal/src/lib/__tests__/scheduler.test.ts
import type { TakeHome } from '../types/assessment'

// Create mock functions
const mockListTakeHomes = jest.fn()
const mockUpdateSessionStatus = jest.fn()
const mockDeleteServiceAccount = jest.fn()

// Mock assessmentManager
jest.mock('../assessments', () => ({
  assessmentManager: {
    listTakeHomes: (...args: unknown[]) => mockListTakeHomes(...args),
    updateSessionStatus: (...args: unknown[]) =>
      mockUpdateSessionStatus(...args),
  },
}))

// Mock openaiService
jest.mock('../openai', () => ({
  openaiService: {
    deleteServiceAccount: (...args: unknown[]) =>
      mockDeleteServiceAccount(...args),
  },
}))

// Mock config
jest.mock('../config', () => ({
  config: {
    services: {
      openaiProjectId: 'test-project-id',
      openaiAdminKey: 'test-admin-key',
    },
  },
}))

// Mock logger
jest.mock('../logger', () => ({
  schedulerLogger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))

// Mock operations manager
jest.mock('../operations', () => ({
  operationManager: {
    getScheduledOperations: jest.fn().mockResolvedValue([]),
    getOperationsForAutoDestroy: jest.fn().mockResolvedValue([]),
  },
}))

// Mock interviews manager
jest.mock('../interviews', () => ({
  interviewManager: {
    getActiveInterviews: jest.fn().mockResolvedValue([]),
  },
}))

import { SchedulerService } from '../scheduler'
import { schedulerLogger } from '../logger'

// Type to access private methods for testing
type SchedulerServicePrivate = SchedulerService & {
  processExpiredTakeHomes: () => Promise<void>
}

describe('SchedulerService - Take-Home Expiration', () => {
  let scheduler: SchedulerService
  const now = Math.floor(Date.now() / 1000)

  beforeEach(() => {
    jest.clearAllMocks()
    // Don't auto-start the scheduler during tests
    jest.spyOn(SchedulerService.prototype, 'start').mockImplementation(() => {})
    scheduler = new SchedulerService()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('processExpiredTakeHomes', () => {
    test('successfully expires take-homes past availableUntil', async () => {
      const expiredTakeHome: TakeHome = {
        PK: 'TAKEHOME#th-123',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-123',
        accessToken: 'token-abc',
        availableFrom: now - 86400 * 8, // 8 days ago
        availableUntil: now - 86400, // 1 day ago (EXPIRED)
        isActivated: false,
        sessionStatus: 'available', // Should be expired
        createdBy: 'user-123',
        createdAt: now - 86400 * 8,
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockListTakeHomes.mockResolvedValue([expiredTakeHome])
      mockUpdateSessionStatus.mockResolvedValue(undefined)

      // Call the private method through the scheduler instance
      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(mockListTakeHomes).toHaveBeenCalledTimes(1)
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
        'th-123',
        'takehome',
        'expired'
      )
      expect(schedulerLogger.info).toHaveBeenCalledWith(
        'Expiring take-home',
        expect.objectContaining({
          takeHomeId: 'th-123',
          availableUntil: expect.any(String),
        })
      )
    })

    test('skips take-homes that are already activated', async () => {
      const activatedTakeHome: TakeHome = {
        PK: 'TAKEHOME#th-456',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-456',
        accessToken: 'token-def',
        availableFrom: now - 86400 * 8,
        availableUntil: now - 86400, // Expired
        isActivated: true, // Already activated
        activatedAt: now - 86400 * 2,
        sessionStatus: 'activated', // Status is activated
        createdBy: 'user-123',
        createdAt: now - 86400 * 8,
        instanceStatus: 'active',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockListTakeHomes.mockResolvedValue([activatedTakeHome])

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(mockListTakeHomes).toHaveBeenCalledTimes(1)
      expect(mockUpdateSessionStatus).not.toHaveBeenCalled()
      expect(schedulerLogger.debug).toHaveBeenCalledWith(
        'Skipping take-home - already activated',
        expect.objectContaining({
          takeHomeId: 'th-456',
        })
      )
    })

    test('skips take-homes that are already expired', async () => {
      const alreadyExpiredTakeHome: TakeHome = {
        PK: 'TAKEHOME#th-789',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-789',
        accessToken: 'token-ghi',
        availableFrom: now - 86400 * 8,
        availableUntil: now - 86400, // Expired
        isActivated: false,
        sessionStatus: 'expired', // Already marked as expired
        createdBy: 'user-123',
        createdAt: now - 86400 * 8,
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockListTakeHomes.mockResolvedValue([alreadyExpiredTakeHome])

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(mockListTakeHomes).toHaveBeenCalledTimes(1)
      expect(mockUpdateSessionStatus).not.toHaveBeenCalled()
    })

    test('deletes OpenAI service accounts when expiring', async () => {
      const takeHomeWithOpenAI: TakeHome = {
        PK: 'TAKEHOME#th-openai',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-openai',
        accessToken: 'token-openai',
        availableFrom: now - 86400 * 8,
        availableUntil: now - 86400, // Expired
        isActivated: false,
        sessionStatus: 'available',
        createdBy: 'user-123',
        createdAt: now - 86400 * 8,
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
        openaiServiceAccount: {
          apiKey: 'sk-test-key',
          projectId: 'test-project',
          serviceAccountId: 'sa-123',
        },
      }

      mockListTakeHomes.mockResolvedValue([takeHomeWithOpenAI])
      mockUpdateSessionStatus.mockResolvedValue(undefined)
      mockDeleteServiceAccount.mockResolvedValue({
        success: true,
        deleted: true,
      })

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(mockDeleteServiceAccount).toHaveBeenCalledWith(
        'test-project-id',
        'sa-123'
      )
      expect(schedulerLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('OpenAI service account deleted'),
        expect.objectContaining({
          serviceAccountId: 'sa-123',
        })
      )
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
        'th-openai',
        'takehome',
        'expired'
      )
    })

    test('handles errors gracefully when OpenAI deletion fails', async () => {
      const takeHomeWithOpenAI: TakeHome = {
        PK: 'TAKEHOME#th-error',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-error',
        accessToken: 'token-error',
        availableFrom: now - 86400 * 8,
        availableUntil: now - 86400,
        isActivated: false,
        sessionStatus: 'available',
        createdBy: 'user-123',
        createdAt: now - 86400 * 8,
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
        openaiServiceAccount: {
          apiKey: 'sk-test-key',
          projectId: 'test-project',
          serviceAccountId: 'sa-error',
        },
      }

      mockListTakeHomes.mockResolvedValue([takeHomeWithOpenAI])
      mockUpdateSessionStatus.mockResolvedValue(undefined)
      mockDeleteServiceAccount.mockResolvedValue({
        success: false,
        error: 'OpenAI API error',
      })

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(schedulerLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('OpenAI service account deletion failed'),
        expect.objectContaining({
          error: 'OpenAI API error',
        })
      )
      // Should still mark as expired even if OpenAI deletion fails
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
        'th-error',
        'takehome',
        'expired'
      )
    })

    test('handles DynamoDB errors gracefully', async () => {
      mockListTakeHomes.mockRejectedValue(new Error('DynamoDB error'))

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(schedulerLogger.error).toHaveBeenCalledWith(
        'Error in processExpiredTakeHomes',
        expect.objectContaining({
          error: 'DynamoDB error',
        })
      )
    })

    test('skips take-homes that are not yet expired', async () => {
      const notYetExpiredTakeHome: TakeHome = {
        PK: 'TAKEHOME#th-future',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-future',
        accessToken: 'token-future',
        availableFrom: now - 86400,
        availableUntil: now + 86400 * 6, // Still has 6 days left
        isActivated: false,
        sessionStatus: 'available',
        createdBy: 'user-123',
        createdAt: now - 86400,
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: {
          cpu: 1024,
          memory: 2048,
          storage: 20,
        },
      }

      mockListTakeHomes.mockResolvedValue([notYetExpiredTakeHome])

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(mockListTakeHomes).toHaveBeenCalledTimes(1)
      expect(mockUpdateSessionStatus).not.toHaveBeenCalled()
    })

    test('processes multiple expired take-homes', async () => {
      const expiredTakeHome1: TakeHome = {
        PK: 'TAKEHOME#th-multi-1',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-multi-1',
        accessToken: 'token-1',
        availableFrom: now - 86400 * 8,
        availableUntil: now - 86400,
        isActivated: false,
        sessionStatus: 'available',
        createdBy: 'user-123',
        createdAt: now - 86400 * 8,
        instanceStatus: 'pending',
        challengeId: 'challenge-123',
        resourceConfig: { cpu: 1024, memory: 2048, storage: 20 },
      }

      const expiredTakeHome2: TakeHome = {
        PK: 'TAKEHOME#th-multi-2',
        SK: 'METADATA',
        sessionType: 'takehome',
        id: 'th-multi-2',
        accessToken: 'token-2',
        availableFrom: now - 86400 * 5,
        availableUntil: now - 3600, // 1 hour ago
        isActivated: false,
        sessionStatus: 'available',
        createdBy: 'user-123',
        createdAt: now - 86400 * 5,
        instanceStatus: 'pending',
        challengeId: 'challenge-456',
        resourceConfig: { cpu: 1024, memory: 2048, storage: 20 },
      }

      mockListTakeHomes.mockResolvedValue([expiredTakeHome1, expiredTakeHome2])
      mockUpdateSessionStatus.mockResolvedValue(undefined)

      await (scheduler as SchedulerServicePrivate).processExpiredTakeHomes()

      expect(mockUpdateSessionStatus).toHaveBeenCalledTimes(2)
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
        'th-multi-1',
        'takehome',
        'expired'
      )
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
        'th-multi-2',
        'takehome',
        'expired'
      )
    })
  })
})
