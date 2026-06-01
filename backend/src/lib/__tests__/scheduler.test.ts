// portal/src/lib/__tests__/scheduler.test.ts
import type { TakeHome } from '../types/assessment'

// Create mock functions
const mockListTakeHomes = vi.fn()
const mockUpdateSessionStatus = vi.fn()
const mockDeleteServiceAccount = vi.fn()

// Mock assessmentManager
vi.mock('../assessments', () => ({
  assessmentManager: {
    listTakeHomes: (...args: unknown[]) => mockListTakeHomes(...args),
    updateSessionStatus: (...args: unknown[]) => mockUpdateSessionStatus(...args),
  },
}))

// Mock openaiService
vi.mock('../openai', () => ({
  openaiService: {
    deleteServiceAccount: (...args: unknown[]) => mockDeleteServiceAccount(...args),
  },
}))

// Mock config
vi.mock('../config', () => ({
  config: {
    services: {
      openaiProjectId: 'test-project-id',
      openaiAdminKey: 'test-admin-key',
    },
  },
}))

// Mock logger
vi.mock('../logger', () => ({
  schedulerLogger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

// Mock operations manager
vi.mock('../operations', () => ({
  operationManager: {
    getScheduledOperations: vi.fn().mockResolvedValue([]),
    getOperationsForAutoDestroy: vi.fn().mockResolvedValue([]),
  },
}))

// Mock interviews manager
vi.mock('../interviews', () => ({
  interviewManager: {
    getActiveInterviews: vi.fn().mockResolvedValue([]),
  },
}))

// Mock API key manager
vi.mock('../apikeys', () => ({
  apiKeyManager: {
    listApiKeys: vi.fn().mockResolvedValue([]),
    getApiKey: vi.fn().mockResolvedValue(null),
    createApiKey: vi.fn(),
    updateApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  },
}))

import { SchedulerService } from '../scheduler'
import { schedulerLogger } from '../logger'

// Type to access private methods for testing
type SchedulerServicePrivate = SchedulerService & {
  processTakeHomes: () => Promise<void>
}

describe('SchedulerService - Take-Home Expiration', () => {
  let scheduler: SchedulerService
  const now = Math.floor(Date.now() / 1000)

  beforeEach(() => {
    vi.clearAllMocks()
    // Don't auto-start the scheduler during tests
    vi.spyOn(SchedulerService.prototype, 'start').mockImplementation(() => {})
    scheduler = new SchedulerService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Take-home expiration is now handled by the private processTakeHomes() method,
  // which expires any take-home with sessionStatus === 'available' whose
  // availableUntil has elapsed. We exercise it via bracket access to the private
  // method (mirroring SchedulerServicePrivate usage elsewhere in the suite).
  describe('processTakeHomes - expiration', () => {
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
        durationHours: 4,
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
      await (scheduler as SchedulerServicePrivate).processTakeHomes()

      expect(mockListTakeHomes).toHaveBeenCalledTimes(1)
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith('th-123', 'takehome', 'expired')
      expect(schedulerLogger.info).toHaveBeenCalledWith(
        'Expiring take-home',
        expect.objectContaining({
          takeHomeId: 'th-123',
          availableUntil: expect.any(String),
        }),
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
        durationHours: 4,
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

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

      // Activated take-homes are not in the 'available' state, so the expiration
      // branch is skipped. With no autoDestroyAt set, the auto-destroy branch is
      // skipped too — so the session status is never updated.
      // NOTE: dropped legacy assertion on the 'Skipping take-home - already
      // activated' debug log; processTakeHomes() no longer emits that message.
      expect(mockListTakeHomes).toHaveBeenCalledTimes(1)
      expect(mockUpdateSessionStatus).not.toHaveBeenCalled()
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
        durationHours: 4,
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

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

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
        durationHours: 4,
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

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

      expect(mockDeleteServiceAccount).toHaveBeenCalledWith('test-project-id', 'sa-123')
      expect(schedulerLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('OpenAI service account deleted'),
        expect.objectContaining({
          serviceAccountId: 'sa-123',
        }),
      )
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith('th-openai', 'takehome', 'expired')
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
        durationHours: 4,
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

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

      expect(schedulerLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('OpenAI service account deletion failed'),
        expect.objectContaining({
          error: 'OpenAI API error',
        }),
      )
      // Should still mark as expired even if OpenAI deletion fails
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith('th-error', 'takehome', 'expired')
    })

    test('handles DynamoDB errors gracefully', async () => {
      mockListTakeHomes.mockRejectedValue(new Error('DynamoDB error'))

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

      expect(schedulerLogger.error).toHaveBeenCalledWith(
        'Error in processTakeHomes',
        expect.objectContaining({
          error: 'DynamoDB error',
        }),
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
        durationHours: 4,
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

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

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
        durationHours: 4,
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
        durationHours: 4,
        createdAt: now - 86400 * 5,
        instanceStatus: 'pending',
        challengeId: 'challenge-456',
        resourceConfig: { cpu: 1024, memory: 2048, storage: 20 },
      }

      mockListTakeHomes.mockResolvedValue([expiredTakeHome1, expiredTakeHome2])
      mockUpdateSessionStatus.mockResolvedValue(undefined)

      await (scheduler as SchedulerServicePrivate).processTakeHomes()

      expect(mockUpdateSessionStatus).toHaveBeenCalledTimes(2)
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith('th-multi-1', 'takehome', 'expired')
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith('th-multi-2', 'takehome', 'expired')
    })
  })
})
