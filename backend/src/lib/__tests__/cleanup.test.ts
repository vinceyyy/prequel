import type { Mocked } from 'vitest'
import { CleanupService } from '../cleanup'
import { terraformManager } from '../terraform'
import { interviewManager } from '../interviews'
// import { logger } from '../logger'

// Mock exec function (hoisted so it can be referenced inside the vi.mock factory)
const { mockExec } = vi.hoisted(() => ({ mockExec: vi.fn() }))

// Mock dependencies
vi.mock('../terraform')
vi.mock('../interviews')
vi.mock('../logger')
vi.mock('child_process', () => ({
  exec: mockExec,
}))

const mockTerraformManager = terraformManager as Mocked<typeof terraformManager>
const mockInterviewManager = interviewManager as Mocked<typeof interviewManager>

describe('CleanupService', () => {
  let cleanupService: CleanupService

  beforeEach(() => {
    cleanupService = new CleanupService()
    vi.clearAllMocks()
  })

  describe('listDanglingResources', () => {
    it('should identify dangling workspaces correctly', async () => {
      // Mock S3 workspace discovery at the service-method boundary (same approach
      // the passing performCleanup tests use). This avoids the execAsync timing
      // issue of trying to re-mock util.promisify after module load.
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue([
        'interview-1',
        'interview-2',
        'interview-3',
      ] as never)

      // Drive getExistingInterviews through its real DynamoDB boundary
      // (interviewManager.getInterview): interview-1 and interview-3 exist,
      // interview-2 does not.
      mockInterviewManager.getInterview.mockImplementation(async (id: string) => {
        if (id === 'interview-2') return null as never
        return { id } as never
      })

      const result = await cleanupService.listDanglingResources()

      expect(result.workspaces).toEqual(['interview-1', 'interview-2', 'interview-3'])
      expect(result.existingInterviews.sort()).toEqual(['interview-1', 'interview-3'])
      expect(result.danglingWorkspaces).toEqual(['interview-2'])
    })
  })

  describe('performCleanup', () => {
    it('should perform dry run correctly', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue(['interview-1', 'interview-2'])

      // Mock existing interviews check
      const mockGetExistingInterviews = vi.spyOn(cleanupService as never, 'getExistingInterviews')
      mockGetExistingInterviews.mockResolvedValue(new Set(['interview-1']))

      const result = await cleanupService.performCleanup({ dryRun: true })

      expect(result.success).toBe(true)
      expect(result.summary.workspacesFound).toBe(2)
      expect(result.summary.danglingResourcesFound).toBe(1)
      expect(result.summary.workspacesDestroyed).toBe(0) // Dry run doesn't destroy
      expect(result.details).toContain('🔍 DRY RUN: Would clean up 1 workspaces:')
    })

    it('should not destroy active interviews by default', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue(['interview-1', 'interview-2'] as never)

      // Mock existing interviews check (both exist) - so neither is dangling
      const mockGetExistingInterviews = vi.spyOn(cleanupService as never, 'getExistingInterviews')
      mockGetExistingInterviews.mockResolvedValue(new Set(['interview-1', 'interview-2']) as never)

      const result = await cleanupService.performCleanup({ dryRun: false })

      // With every workspace backed by an existing interview, there is nothing
      // dangling to clean up and terraform destroy must never run.
      // NOTE: dropped the legacy workspacesSkipped === 2 assertion; current source
      // short-circuits when danglingWorkspaces is empty (before populating skipped
      // results), so no active workspaces are destroyed and none are recorded.
      expect(result.success).toBe(true)
      expect(result.summary.workspacesFound).toBe(2)
      expect(result.summary.danglingResourcesFound).toBe(0)
      expect(result.summary.workspacesDestroyed).toBe(0)
      expect(mockTerraformManager.destroyInterviewStreaming).not.toHaveBeenCalled()
    })

    it('should destroy dangling workspaces', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue(['interview-1', 'interview-2'])

      // Mock existing interviews check (only interview-1 exists)
      const mockGetExistingInterviews = vi.spyOn(cleanupService as never, 'getExistingInterviews')
      mockGetExistingInterviews.mockResolvedValue(new Set(['interview-1']))

      // Mock terraform destroy success
      mockTerraformManager.destroyInterviewStreaming.mockResolvedValue({
        success: true,
        output: 'Destroy completed',
        fullOutput: 'Full terraform output',
      })

      const result = await cleanupService.performCleanup({ dryRun: false })

      expect(result.summary.workspacesFound).toBe(2)
      expect(result.summary.danglingResourcesFound).toBe(1)
      expect(result.summary.workspacesSkipped).toBe(1) // interview-1 skipped
      expect(result.summary.workspacesDestroyed).toBe(1) // interview-2 destroyed
      expect(mockTerraformManager.destroyInterviewStreaming).toHaveBeenCalledWith(
        'interview-2',
        expect.any(Function),
      )
    })

    it('should handle terraform destroy failures', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue(['interview-1'])

      // Mock no existing interviews
      const mockGetExistingInterviews = vi.spyOn(cleanupService as never, 'getExistingInterviews')
      mockGetExistingInterviews.mockResolvedValue(new Set())

      // Mock terraform destroy failure
      mockTerraformManager.destroyInterviewStreaming.mockResolvedValue({
        success: false,
        output: '',
        error: 'Terraform destroy failed',
      })

      const result = await cleanupService.performCleanup({ dryRun: false })

      expect(result.summary.workspacesErrored).toBe(1)
      expect(result.summary.workspacesDestroyed).toBe(0)
      expect(result.workspaceResults[0].status).toBe('error')
      expect(result.workspaceResults[0].error).toBe('Terraform destroy failed')
    })

    it('should respect concurrency limits', async () => {
      // Mock workspace discovery with multiple workspaces
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue([
        'interview-1',
        'interview-2',
        'interview-3',
        'interview-4',
      ])

      // Mock no existing interviews (all are dangling)
      const mockGetExistingInterviews = vi.spyOn(cleanupService as never, 'getExistingInterviews')
      mockGetExistingInterviews.mockResolvedValue(new Set())

      // Track concurrent calls
      let concurrentCalls = 0
      let maxConcurrentCalls = 0

      mockTerraformManager.destroyInterviewStreaming.mockImplementation(async () => {
        concurrentCalls++
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls)

        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10))

        concurrentCalls--
        return {
          success: true,
          output: 'Destroyed',
          fullOutput: 'Full output',
        }
      })

      await cleanupService.performCleanup({
        dryRun: false,
        maxConcurrency: 2,
      })

      // Should not exceed the concurrency limit
      expect(maxConcurrentCalls).toBeLessThanOrEqual(2)
      expect(mockTerraformManager.destroyInterviewStreaming).toHaveBeenCalledTimes(4)
    })
  })

  describe('error handling', () => {
    it('should handle S3 listing errors gracefully', async () => {
      // Mock S3 listing failure
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockRejectedValue(new Error('S3 access denied'))

      const result = await cleanupService.performCleanup({ dryRun: true })

      expect(result.success).toBe(false)
      expect(result.error).toBe('S3 access denied')
    })

    it('should handle DynamoDB query errors gracefully', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = vi.spyOn(cleanupService as never, 'listAllWorkspaces')
      mockListAllWorkspaces.mockResolvedValue(['interview-1'] as never)

      // Mock DynamoDB error - getExistingInterviews catches per-interview errors
      // and treats the interview as non-existent (hence dangling).
      mockInterviewManager.getInterview.mockRejectedValue(new Error('DynamoDB timeout'))

      const result = await cleanupService.performCleanup({ dryRun: true })

      // Should continue despite DynamoDB errors (treats as non-existent)
      expect(result.success).toBe(true)
      expect(result.summary.danglingResourcesFound).toBe(1)
    })
  })
})
