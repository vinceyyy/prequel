import { renderHook, waitFor, act } from '@testing-library/react'
import { useOperations } from '../useOperations'

// Mock fetch globally
global.fetch = jest.fn()

const mockOperations = [
  {
    id: 'op-1',
    type: 'create' as const,
    status: 'completed' as const,
    interviewId: 'int-1',
    candidateName: 'John Doe',
    scenario: 'javascript',
    startedAt: '2024-01-01T10:00:00Z',
    completedAt: '2024-01-01T10:05:00Z',
    result: {
      success: true,
      accessUrl: 'https://example.com/interview/int-1',
    },
  },
  {
    id: 'op-2',
    type: 'destroy' as const,
    status: 'running' as const,
    interviewId: 'int-2',
    startedAt: '2024-01-01T11:00:00Z',
  },
]

describe('useOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('loads operations on mount', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    const { result } = renderHook(() => useOperations())

    await waitFor(() => {
      expect(result.current.operations).toEqual(mockOperations)
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/operations')
  })

  it('loads operations with interview filter', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    const { result } = renderHook(() => useOperations('int-1'))

    await waitFor(() => {
      expect(result.current.operations).toEqual([mockOperations[0]])
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/operations?interviewId=int-1'
    )
  })

  it('handles loading state correctly', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [] }),
    })

    const { result } = renderHook(() => useOperations())

    expect(result.current.loading).toBe(false)

    // Test createInterview loading state
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviewId: 'int-new' }),
    })

    act(() => {
      result.current.createInterview('Test User', 'javascript')
    })

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('creates interview successfully', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ interviewId: 'int-new' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: mockOperations }),
      })

    const { result } = renderHook(() => useOperations())

    await act(async () => {
      const response = await result.current.createInterview(
        'Test User',
        'javascript'
      )
      expect(response).toEqual({ interviewId: 'int-new' })
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/interviews/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateName: 'Test User',
        scenario: 'javascript',
      }),
    })
  })

  it('destroys interview successfully', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })

    const { result } = renderHook(() => useOperations())

    await act(async () => {
      const response = await result.current.destroyInterview('int-1')
      expect(response).toEqual({ success: true })
    })

    expect(global.fetch).toHaveBeenCalledWith('/api/interviews/int-1/destroy', {
      method: 'POST',
    })
  })

  it('handles create interview error', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    const { result } = renderHook(() => useOperations())

    await act(async () => {
      await expect(
        result.current.createInterview('Test User', 'javascript')
      ).rejects.toThrow('Failed to create interview')
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error creating interview:',
      expect.any(Error)
    )
    expect(result.current.loading).toBe(false)

    consoleSpy.mockRestore()
  })

  it('handles destroy interview error', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    const { result } = renderHook(() => useOperations())

    await act(async () => {
      await expect(result.current.destroyInterview('int-1')).rejects.toThrow(
        'Failed to destroy interview'
      )
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error destroying interview:',
      expect.any(Error)
    )
    expect(result.current.loading).toBe(false)

    consoleSpy.mockRestore()
  })

  it('handles fetch errors gracefully', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Network error')
    )

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    const { result } = renderHook(() => useOperations())

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load operations:',
        expect.any(Error)
      )
    })

    expect(result.current.operations).toEqual([])

    consoleSpy.mockRestore()
  })

  it('polls operations when there are active operations', async () => {
    const runningOperations = [
      { ...mockOperations[0], status: 'running' as const },
      { ...mockOperations[1], status: 'pending' as const },
    ]

    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: runningOperations }),
    })

    renderHook(() => useOperations())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // Fast-forward time to trigger polling
    act(() => {
      jest.advanceTimersByTime(3000)
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    // Fast-forward again
    act(() => {
      jest.advanceTimersByTime(3000)
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })
  })

  it('stops polling when no active operations', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        operations: [{ ...mockOperations[0], status: 'completed' }],
      }),
    })

    renderHook(() => useOperations())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // Fast-forward time - should not trigger additional polling
    act(() => {
      jest.advanceTimersByTime(6000)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes operations manually', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    const { result } = renderHook(() => useOperations())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await result.current.refreshOperations()
    })

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
