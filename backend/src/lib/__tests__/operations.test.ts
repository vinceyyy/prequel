import type { Mock } from 'vitest'
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

  // cancelScheduledOperationsForInterview is now async + DynamoDB-backed. It:
  //   1. Queries getOperationsByInterview (interviewId-type-index GSI)
  //   2. Filters for status === 'scheduled'
  //   3. Issues an UpdateItemCommand per scheduled op (status -> cancelled)
  //   4. Re-reads each op via GetItem and returns the count cancelled
  // We mock the DynamoDB client's send() the same way the passing test below
  // does (swap operationManager.dynamoClient for a stub), returning marshalled
  // DynamoDB-JSON items.
  describe('cancelScheduledOperationsForInterview', () => {
    let mockSend: Mock
    let originalClient: unknown

    // Builds a marshalled DynamoDB item for an operation.
    const op = (id: string, status: string, interviewId: string, type = 'create') => ({
      id: { S: id },
      type: { S: type },
      status: { S: status },
      interviewId: { S: interviewId },
      candidateName: { S: 'Test Candidate' },
      challenge: { S: 'javascript' },
      createdAt: { N: String(Math.floor(Date.now() / 1000)) },
      logs: { L: [] },
    })

    beforeEach(() => {
      mockSend = vi.fn()
      originalClient = (operationManager as unknown as { dynamoClient: unknown }).dynamoClient
      ;(operationManager as unknown as { dynamoClient: { send: Mock } }).dynamoClient = {
        send: mockSend,
      }
    })

    afterEach(() => {
      ;(operationManager as unknown as { dynamoClient: unknown }).dynamoClient = originalClient
    })

    it('should cancel only scheduled operations for a specific interview', async () => {
      const interviewId = 'test-interview-123'

      mockSend.mockImplementation((command: { input?: Record<string, unknown> }) => {
        const ctor = command.constructor.name
        if (ctor === 'QueryCommand') {
          // getOperationsByInterview -> one scheduled, one running
          return Promise.resolve({
            Items: [
              op('op-scheduled', 'scheduled', interviewId),
              op('op-running', 'running', interviewId),
            ],
          })
        }
        if (ctor === 'UpdateItemCommand') {
          return Promise.resolve({})
        }
        if (ctor === 'GetItemCommand') {
          // Re-read after cancel: reflect the new cancelled status
          return Promise.resolve({
            Item: {
              ...op('op-scheduled', 'cancelled', interviewId),
              result: {
                M: {
                  success: { BOOL: false },
                  error: { S: 'Operation cancelled due to manual interview destruction' },
                },
              },
            },
          })
        }
        return Promise.resolve({})
      })

      const cancelledCount =
        await operationManager.cancelScheduledOperationsForInterview(interviewId)

      expect(cancelledCount).toBe(1)

      // Only the scheduled op should have been updated to cancelled.
      const updateCalls = mockSend.mock.calls.filter(
        (c) => c[0].constructor.name === 'UpdateItemCommand',
      )
      expect(updateCalls).toHaveLength(1)
      const updateInput = updateCalls[0][0].input
      expect(updateInput.Key.id.S).toBe('op-scheduled')
      expect(updateInput.ExpressionAttributeValues[':status'].S).toBe('cancelled')
      expect(updateInput.ExpressionAttributeValues[':result'].M.error.S).toBe(
        'Operation cancelled due to manual interview destruction',
      )
    })

    it('should cancel multiple scheduled operations for the same interview', async () => {
      const interviewId = 'test-interview-123'

      mockSend.mockImplementation((command: { input?: Record<string, unknown> }) => {
        const ctor = command.constructor.name
        if (ctor === 'QueryCommand') {
          return Promise.resolve({
            Items: [
              op('op-1', 'scheduled', interviewId, 'create'),
              op('op-2', 'scheduled', interviewId, 'destroy'),
            ],
          })
        }
        if (ctor === 'GetItemCommand') {
          return Promise.resolve({ Item: op('op-1', 'cancelled', interviewId) })
        }
        return Promise.resolve({})
      })

      const cancelledCount =
        await operationManager.cancelScheduledOperationsForInterview(interviewId)

      expect(cancelledCount).toBe(2)
      const updateCalls = mockSend.mock.calls.filter(
        (c) => c[0].constructor.name === 'UpdateItemCommand',
      )
      expect(updateCalls).toHaveLength(2)
    })

    it('should return 0 when no scheduled operations exist for the interview', async () => {
      mockSend.mockImplementation((command: { input?: Record<string, unknown> }) => {
        const ctor = command.constructor.name
        if (ctor === 'QueryCommand') {
          // Only a pending op exists, nothing scheduled
          return Promise.resolve({ Items: [op('op-pending', 'pending', 'other-interview')] })
        }
        return Promise.resolve({})
      })

      const cancelledCount =
        await operationManager.cancelScheduledOperationsForInterview('nonexistent-interview')

      expect(cancelledCount).toBe(0)
      // No update should be issued when nothing is scheduled.
      const updateCalls = mockSend.mock.calls.filter(
        (c) => c[0].constructor.name === 'UpdateItemCommand',
      )
      expect(updateCalls).toHaveLength(0)
    })
  })

  test('operations reference instanceId for both interviews and take-homes', async () => {
    // Mock DynamoDB client to avoid actual DB calls
    const mockSend = vi.fn()

    // Store original client to restore later
    const originalClient = (operationManager as unknown as { dynamoClient: unknown }).dynamoClient
    ;(operationManager as unknown as { dynamoClient: { send: Mock } }).dynamoClient = {
      send: mockSend,
    }

    // Mock successful PutItem responses
    mockSend
      .mockResolvedValueOnce({}) // For interview operation creation
      .mockResolvedValueOnce({}) // For take-home operation creation

    const interviewOp = await operationManager.createOperation(
      'create',
      'INTERVIEW#int-123', // instanceId can be interview ID
      'John Doe',
      'challenge-123',
    )

    const takeHomeOp = await operationManager.createOperation(
      'create',
      'TAKEHOME#th-456', // instanceId can be take-home ID
      'Jane Smith',
      'challenge-456',
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
    ;(operationManager as unknown as { dynamoClient: unknown }).dynamoClient = originalClient
  })

  // getActiveOperations is async + DynamoDB-backed. It runs three GSI queries in
  // parallel (pending, running, scheduled) via getOperationsByStatus, then merges
  // and sorts the results by createdAt (newest first). We mock the DynamoDB send()
  // per status, matching the same client-swap pattern used by the passing test.
  describe('getActiveOperations', () => {
    let mockSend: Mock
    let originalClient: unknown

    const item = (
      id: string,
      status: string,
      interviewId: string,
      candidateName: string,
      createdAt: string,
    ) => ({
      id: { S: id },
      type: { S: 'create' },
      status: { S: status },
      interviewId: { S: interviewId },
      candidateName: { S: candidateName },
      createdAt: { N: createdAt },
      logs: { L: [] },
    })

    // Routes each QueryCommand to a response based on the queried status.
    const respondByStatus = (responses: Record<string, unknown[]>) => {
      mockSend.mockImplementation((command: { input: Record<string, never> }) => {
        const status = (command.input.ExpressionAttributeValues as { ':status': { S: string } })[
          ':status'
        ].S
        return Promise.resolve({ Items: responses[status] || [] })
      })
    }

    beforeEach(() => {
      mockSend = vi.fn()
      originalClient = (operationManager as unknown as { dynamoClient: unknown }).dynamoClient
      ;(operationManager as unknown as { dynamoClient: { send: Mock } }).dynamoClient = {
        send: mockSend,
      }
    })

    afterEach(() => {
      ;(operationManager as unknown as { dynamoClient: unknown }).dynamoClient = originalClient
    })

    it('should return pending, running and scheduled operations sorted by createdAt desc', async () => {
      respondByStatus({
        pending: [item('op-pending-1', 'pending', 'int-0', 'Pending Candidate', '1640995100')],
        running: [item('op-running-1', 'running', 'int-1', 'Running Candidate', '1640995200')],
        scheduled: [
          item('op-scheduled-1', 'scheduled', 'int-2', 'Scheduled Candidate', '1640995300'),
        ],
      })

      const activeOperations = await operationManager.getActiveOperations()

      // All three statuses are included.
      expect(activeOperations).toHaveLength(3)
      // Sorted newest-first by createdAt: scheduled (300) > running (200) > pending (100).
      expect(activeOperations.map((o) => o.id)).toEqual([
        'op-scheduled-1',
        'op-running-1',
        'op-pending-1',
      ])
      expect(activeOperations[0]).toMatchObject({
        id: 'op-scheduled-1',
        status: 'scheduled',
        candidateName: 'Scheduled Candidate',
      })

      // Three GSI queries (one per active status) on the status-scheduledAt-index.
      expect(mockSend).toHaveBeenCalledTimes(3)
      for (const status of ['pending', 'running', 'scheduled']) {
        expect(mockSend).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              IndexName: 'status-scheduledAt-index',
              KeyConditionExpression: '#status = :status',
              ExpressionAttributeValues: expect.objectContaining({
                ':status': { S: status },
              }),
            }),
          }),
        )
      }
    })

    it('should return empty array when no active operations exist', async () => {
      respondByStatus({ pending: [], running: [], scheduled: [] })

      const activeOperations = await operationManager.getActiveOperations()

      expect(activeOperations).toHaveLength(0)
      expect(mockSend).toHaveBeenCalledTimes(3)
    })
  })
})
