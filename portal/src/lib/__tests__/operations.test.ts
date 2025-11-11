import { operationManager } from '../operations'

describe('OperationManager', () => {
  beforeEach(() => {
    // Clear operations before each test (only for in-memory operations)
    try {
      operationManager['operations']?.clear()
    } catch {
      // Ignore if operations is not available (for DynamoDB-only tests)
    }
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

  test('operations reference instanceId for both interviews and take-homes', async () => {
    // Mock DynamoDB client to avoid actual DB calls
    const mockSend = jest.fn()

    // Store original client to restore later
    const originalClient = (
      operationManager as unknown as { dynamoClient: unknown }
    ).dynamoClient
    ;(operationManager as unknown as { dynamoClient: { send: jest.Mock } }).dynamoClient =
      { send: mockSend }

    // Mock successful PutItem responses
    mockSend
      .mockResolvedValueOnce({}) // For interview operation creation
      .mockResolvedValueOnce({}) // For take-home operation creation

    const interviewOp = await operationManager.createOperation(
      'create',
      'INTERVIEW#int-123', // instanceId can be interview ID
      'John Doe',
      'challenge-123'
    )

    const takeHomeOp = await operationManager.createOperation(
      'create',
      'TAKEHOME#th-456', // instanceId can be take-home ID
      'Jane Smith',
      'challenge-456'
    )

    expect(interviewOp).toBeDefined()
    expect(takeHomeOp).toBeDefined()

    // Mock GetItem responses for fetching operations
    mockSend
      .mockResolvedValueOnce({
        Item: {
          id: { S: interviewOp },
          type: { S: 'create' },
          status: { S: 'pending' },
          interviewId: { S: 'INTERVIEW#int-123' },
          candidateName: { S: 'John Doe' },
          challenge: { S: 'challenge-123' },
          createdAt: { N: String(Math.floor(Date.now() / 1000)) },
          logs: { L: [] },
        },
      })
      .mockResolvedValueOnce({
        Item: {
          id: { S: takeHomeOp },
          type: { S: 'create' },
          status: { S: 'pending' },
          interviewId: { S: 'TAKEHOME#th-456' },
          candidateName: { S: 'Jane Smith' },
          challenge: { S: 'challenge-456' },
          createdAt: { N: String(Math.floor(Date.now() / 1000)) },
          logs: { L: [] },
        },
      })

    const fetchedInterviewOp = await operationManager.getOperation(interviewOp)
    expect(fetchedInterviewOp?.interviewId).toBe('INTERVIEW#int-123')

    const fetchedTakeHomeOp = await operationManager.getOperation(takeHomeOp)
    expect(fetchedTakeHomeOp?.interviewId).toBe('TAKEHOME#th-456')

    // Restore original client
    ;(operationManager as unknown as { dynamoClient: unknown }).dynamoClient =
      originalClient
  })

  describe('getActiveOperations', () => {
    it('should return only running and scheduled operations', async () => {
      // Mock DynamoDB client to avoid actual DB calls in unit tests
      const mockSend = jest.fn()

      // Store original client to restore later
      const originalClient = (
        operationManager as unknown as { dynamoClient: unknown }
      ).dynamoClient
      ;(
        operationManager as unknown as { dynamoClient: { send: jest.Mock } }
      ).dynamoClient = { send: mockSend }

      // Mock responses for running and scheduled operations
      mockSend
        .mockResolvedValueOnce({
          // Response for getOperationsByStatus('running')
          Items: [
            {
              id: { S: 'op-running-1' },
              type: { S: 'create' },
              status: { S: 'running' },
              interviewId: { S: 'int-1' },
              candidateName: { S: 'Running Candidate' },
              createdAt: { N: '1640995200' }, // 2022-01-01 timestamp
            },
          ],
        })
        .mockResolvedValueOnce({
          // Response for getOperationsByStatus('scheduled')
          Items: [
            {
              id: { S: 'op-scheduled-1' },
              type: { S: 'create' },
              status: { S: 'scheduled' },
              interviewId: { S: 'int-2' },
              candidateName: { S: 'Scheduled Candidate' },
              createdAt: { N: '1640995300' }, // 2022-01-01 timestamp
            },
          ],
        })

      const activeOperations = await operationManager.getActiveOperations()

      expect(activeOperations).toHaveLength(2)
      expect(activeOperations[0]).toMatchObject({
        id: 'op-scheduled-1',
        status: 'scheduled',
        candidateName: 'Scheduled Candidate',
      })
      expect(activeOperations[1]).toMatchObject({
        id: 'op-running-1',
        status: 'running',
        candidateName: 'Running Candidate',
      })

      // Verify the correct GSI queries were made
      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            IndexName: 'status-scheduledAt-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeValues: expect.objectContaining({
              ':status': { S: 'running' },
            }),
          }),
        })
      )
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            IndexName: 'status-scheduledAt-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeValues: expect.objectContaining({
              ':status': { S: 'scheduled' },
            }),
          }),
        })
      )

      // Restore original client
      ;(operationManager as unknown as { dynamoClient: unknown }).dynamoClient =
        originalClient
    })

    it('should return empty array when no active operations exist', async () => {
      // Mock DynamoDB client
      const mockSend = jest.fn()

      // Store original client to restore later
      const originalClient = (
        operationManager as unknown as { dynamoClient: unknown }
      ).dynamoClient
      ;(
        operationManager as unknown as { dynamoClient: { send: jest.Mock } }
      ).dynamoClient = { send: mockSend }

      // Mock empty responses
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // running operations
        .mockResolvedValueOnce({ Items: [] }) // scheduled operations

      const activeOperations = await operationManager.getActiveOperations()

      expect(activeOperations).toHaveLength(0)
      expect(mockSend).toHaveBeenCalledTimes(2)

      // Restore original client
      ;(operationManager as unknown as { dynamoClient: unknown }).dynamoClient =
        originalClient
    })
  })
})
