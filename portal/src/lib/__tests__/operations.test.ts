import { operationManager } from '../operations'

describe('OperationManager', () => {
  beforeEach(() => {
    // Clear operations before each test
    operationManager['operations'].clear()
  })

  describe('cancelScheduledOperationsForInterview', () => {
    it('should cancel scheduled operations for a specific interview', () => {
      const interviewId = 'test-interview-123'

      // Create some operations
      const scheduleOpId = operationManager.createOperation(
        'create',
        interviewId,
        'Test Candidate',
        'javascript',
        new Date(Date.now() + 60000) // scheduled for 1 minute in future
      )

      const regularOpId = operationManager.createOperation(
        'create',
        'other-interview',
        'Other Candidate',
        'python'
      )

      // Verify initial state
      expect(operationManager.getOperation(scheduleOpId)?.status).toBe(
        'scheduled'
      )
      expect(operationManager.getOperation(regularOpId)?.status).toBe('pending')

      // Cancel scheduled operations for the interview
      const cancelledCount =
        operationManager.cancelScheduledOperationsForInterview(interviewId)

      // Verify results
      expect(cancelledCount).toBe(1)
      expect(operationManager.getOperation(scheduleOpId)?.status).toBe(
        'cancelled'
      )
      expect(operationManager.getOperation(scheduleOpId)?.result?.error).toBe(
        'Operation cancelled due to manual interview destruction'
      )
      expect(operationManager.getOperation(regularOpId)?.status).toBe('pending') // should be unchanged
    })

    it('should handle multiple scheduled operations for the same interview', () => {
      const interviewId = 'test-interview-123'

      // Create multiple scheduled operations for the same interview
      const scheduleOpId1 = operationManager.createOperation(
        'create',
        interviewId,
        'Test Candidate',
        'javascript',
        new Date(Date.now() + 60000)
      )

      const scheduleOpId2 = operationManager.createOperation(
        'destroy',
        interviewId,
        'Test Candidate',
        'javascript',
        new Date(Date.now() + 120000)
      )

      // Cancel scheduled operations for the interview
      const cancelledCount =
        operationManager.cancelScheduledOperationsForInterview(interviewId)

      // Verify results
      expect(cancelledCount).toBe(2)
      expect(operationManager.getOperation(scheduleOpId1)?.status).toBe(
        'cancelled'
      )
      expect(operationManager.getOperation(scheduleOpId2)?.status).toBe(
        'cancelled'
      )
    })

    it('should return 0 when no scheduled operations exist for the interview', () => {
      const interviewId = 'nonexistent-interview'

      // Create an operation for a different interview
      operationManager.createOperation(
        'create',
        'other-interview',
        'Other Candidate',
        'python'
      )

      // Try to cancel scheduled operations for non-existent interview
      const cancelledCount =
        operationManager.cancelScheduledOperationsForInterview(interviewId)

      // Verify results
      expect(cancelledCount).toBe(0)
    })

    it('should only cancel scheduled operations, not other statuses', () => {
      const interviewId = 'test-interview-123'

      // Create operations with different statuses
      const scheduleOpId = operationManager.createOperation(
        'create',
        interviewId,
        'Test Candidate',
        'javascript',
        new Date(Date.now() + 60000)
      )

      const pendingOpId = operationManager.createOperation(
        'create',
        interviewId,
        'Test Candidate',
        'javascript'
      )

      // Change pending operation to running
      operationManager.updateOperationStatus(pendingOpId, 'running')

      // Cancel scheduled operations for the interview
      const cancelledCount =
        operationManager.cancelScheduledOperationsForInterview(interviewId)

      // Verify results
      expect(cancelledCount).toBe(1)
      expect(operationManager.getOperation(scheduleOpId)?.status).toBe(
        'cancelled'
      )
      expect(operationManager.getOperation(pendingOpId)?.status).toBe('running') // should be unchanged
    })
  })
})
