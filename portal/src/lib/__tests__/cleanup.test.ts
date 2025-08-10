import { CleanupService } from '../cleanup'
import { terraformManager } from '../terraform'
import { interviewManager } from '../interviews'
// import { logger } from '../logger'

// Mock dependencies
jest.mock('../terraform')
jest.mock('../interviews')
jest.mock('../logger')
jest.mock('child_process')

const mockTerraformManager = terraformManager as jest.Mocked<
  typeof terraformManager
>
const mockInterviewManager = interviewManager as jest.Mocked<
  typeof interviewManager
>

// Mock exec function
const mockExec = jest.fn()
jest.mock('child_process', () => ({
  exec: mockExec,
}))

describe('CleanupService', () => {
  let cleanupService: CleanupService

  beforeEach(() => {
    cleanupService = new CleanupService()
    jest.clearAllMocks()
  })

  describe('listDanglingResources', () => {
    it('should identify dangling workspaces correctly', async () => {
      // Mock S3 workspace listing
      const mockPromisify = jest.fn().mockResolvedValue({
        stdout: `
2025-01-10 10:30:00        123 workspaces/interview-1/main.tf
2025-01-10 10:31:00        456 workspaces/interview-2/terraform.tfvars
2025-01-10 10:32:00        789 workspaces/interview-3/terraform.tfstate
        `.trim(),
      })

      // Mock interview manager responses
      mockInterviewManager.getInterview
        .mockResolvedValueOnce({ id: 'interview-1' } as never) // interview-1 exists
        .mockResolvedValueOnce(null) // interview-2 doesn't exist
        .mockResolvedValueOnce({ id: 'interview-3' } as never) // interview-3 exists

      // Setup exec mock
      mockExec.mockImplementation((command, options, callback) => {
        if (typeof callback === 'function') {
          callback(
            null,
            mockPromisify().then(result => result)
          )
        }
      })

      // Mock the promisify function
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { promisify } = require('util')
      promisify.mockReturnValue(mockPromisify)

      const result = await cleanupService.listDanglingResources()

      expect(result).toEqual({
        workspaces: ['interview-1', 'interview-2', 'interview-3'],
        existingInterviews: ['interview-1', 'interview-3'],
        danglingWorkspaces: ['interview-2'],
      })
    })
  })

  describe('performCleanup', () => {
    it('should perform dry run correctly', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockResolvedValue(['interview-1', 'interview-2'])

      // Mock existing interviews check
      const mockGetExistingInterviews = jest.spyOn(
        cleanupService as never,
        'getExistingInterviews'
      )
      mockGetExistingInterviews.mockResolvedValue(new Set(['interview-1']))

      const result = await cleanupService.performCleanup({ dryRun: true })

      expect(result.success).toBe(true)
      expect(result.summary.workspacesFound).toBe(2)
      expect(result.summary.danglingResourcesFound).toBe(1)
      expect(result.summary.workspacesDestroyed).toBe(0) // Dry run doesn't destroy
      expect(result.details).toContain(
        '🔍 DRY RUN: Would clean up 1 workspaces:'
      )
    })

    it('should skip active interviews by default', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockResolvedValue(['interview-1', 'interview-2'])

      // Mock existing interviews check (both exist)
      const mockGetExistingInterviews = jest.spyOn(
        cleanupService as never,
        'getExistingInterviews'
      )
      mockGetExistingInterviews.mockResolvedValue(
        new Set(['interview-1', 'interview-2'])
      )

      const result = await cleanupService.performCleanup({ dryRun: false })

      expect(result.summary.workspacesSkipped).toBe(2)
      expect(result.summary.workspacesDestroyed).toBe(0)
      expect(result.workspaceResults.every(ws => ws.status === 'skipped')).toBe(
        true
      )
    })

    it('should destroy dangling workspaces', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockResolvedValue(['interview-1', 'interview-2'])

      // Mock existing interviews check (only interview-1 exists)
      const mockGetExistingInterviews = jest.spyOn(
        cleanupService as never,
        'getExistingInterviews'
      )
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
      expect(
        mockTerraformManager.destroyInterviewStreaming
      ).toHaveBeenCalledWith('interview-2', expect.any(Function))
    })

    it('should handle terraform destroy failures', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockResolvedValue(['interview-1'])

      // Mock no existing interviews
      const mockGetExistingInterviews = jest.spyOn(
        cleanupService as never,
        'getExistingInterviews'
      )
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
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockResolvedValue([
        'interview-1',
        'interview-2',
        'interview-3',
        'interview-4',
      ])

      // Mock no existing interviews (all are dangling)
      const mockGetExistingInterviews = jest.spyOn(
        cleanupService as never,
        'getExistingInterviews'
      )
      mockGetExistingInterviews.mockResolvedValue(new Set())

      // Track concurrent calls
      let concurrentCalls = 0
      let maxConcurrentCalls = 0

      mockTerraformManager.destroyInterviewStreaming.mockImplementation(
        async () => {
          concurrentCalls++
          maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls)

          // Simulate some async work
          await new Promise(resolve => setTimeout(resolve, 10))

          concurrentCalls--
          return {
            success: true,
            output: 'Destroyed',
            fullOutput: 'Full output',
          }
        }
      )

      await cleanupService.performCleanup({
        dryRun: false,
        maxConcurrency: 2,
      })

      // Should not exceed the concurrency limit
      expect(maxConcurrentCalls).toBeLessThanOrEqual(2)
      expect(
        mockTerraformManager.destroyInterviewStreaming
      ).toHaveBeenCalledTimes(4)
    })
  })

  describe('error handling', () => {
    it('should handle S3 listing errors gracefully', async () => {
      // Mock S3 listing failure
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockRejectedValue(new Error('S3 access denied'))

      const result = await cleanupService.performCleanup({ dryRun: true })

      expect(result.success).toBe(false)
      expect(result.error).toBe('S3 access denied')
    })

    it('should handle DynamoDB query errors gracefully', async () => {
      // Mock workspace discovery
      const mockListAllWorkspaces = jest.spyOn(
        cleanupService as never,
        'listAllWorkspaces'
      )
      mockListAllWorkspaces.mockResolvedValue(['interview-1'])

      // Mock DynamoDB error
      mockInterviewManager.getInterview.mockRejectedValue(
        new Error('DynamoDB timeout')
      )

      const result = await cleanupService.performCleanup({ dryRun: true })

      // Should continue despite DynamoDB errors (treats as non-existent)
      expect(result.success).toBe(true)
      expect(result.summary.danglingResourcesFound).toBe(1)
    })
  })
})
