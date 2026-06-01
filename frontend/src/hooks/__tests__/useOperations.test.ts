import { renderHook, waitFor, act } from '@testing-library/react'
import type { Mock } from 'vitest'
import { useOperations } from '../useOperations'

// Mock fetch globally
globalThis.fetch = vi.fn()

const mockOperations = [
  {
    id: 'op-1',
    type: 'create' as const,
    status: 'completed' as const,
    interviewId: 'int-1',
    candidateName: 'John Doe',
    challenge: 'javascript',
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
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads operations on mount', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    const { result } = renderHook(() => useOperations())

    await waitFor(() => {
      expect(result.current.operations).toEqual(mockOperations)
    })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/operations')
  })

  it('loads operations with interview filter', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    const { result } = renderHook(() => useOperations('int-1'))

    await waitFor(() => {
      expect(result.current.operations).toEqual([mockOperations[0]])
    })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/operations?interviewId=int-1')
  })

  it('handles loading state correctly', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [] }),
    })

    const { result } = renderHook(() => useOperations())

    expect(result.current.loading).toBe(false)

    // Test createInterview loading state
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
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
    ;(globalThis.fetch as Mock)
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
      const response = await result.current.createInterview('Test User', 'javascript')
      expect(response).toEqual({ interviewId: 'int-new' })
    })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/interviews/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateName: 'Test User',
        challenge: 'javascript',
      }),
    })
  })

  it('destroys interview successfully', async () => {
    ;(globalThis.fetch as Mock)
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

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/interviews/int-1/destroy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        candidateName: undefined,
        challenge: undefined,
      }),
    })
  })

  it('handles create interview error', async () => {
    ;(globalThis.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useOperations())

    await act(async () => {
      await expect(result.current.createInterview('Test User', 'javascript')).rejects.toThrow(
        'Failed to create interview',
      )
    })

    expect(consoleSpy).toHaveBeenCalledWith('Error creating interview:', expect.any(Error))
    expect(result.current.loading).toBe(false)

    consoleSpy.mockRestore()
  })

  it('handles destroy interview error', async () => {
    ;(globalThis.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useOperations())

    await act(async () => {
      await expect(result.current.destroyInterview('int-1')).rejects.toThrow(
        'Failed to destroy interview',
      )
    })

    expect(consoleSpy).toHaveBeenCalledWith('Error destroying interview:', expect.any(Error))
    expect(result.current.loading).toBe(false)

    consoleSpy.mockRestore()
  })

  it('handles fetch errors gracefully', async () => {
    ;(globalThis.fetch as Mock).mockRejectedValueOnce(new Error('Network error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useOperations())

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load operations:', expect.any(Error))
    })

    expect(result.current.operations).toEqual([])

    consoleSpy.mockRestore()
  })

  it('does not poll operations (SSE-driven, no interval polling)', async () => {
    const runningOperations = [
      { ...mockOperations[0], status: 'running' as const },
      { ...mockOperations[1], status: 'pending' as const },
    ]

    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: runningOperations }),
    })

    renderHook(() => useOperations())

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    // Advancing timers must not trigger additional fetches: the hook relies on
    // SSE for real-time updates and intentionally has no polling interval.
    vi.useFakeTimers()
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    vi.useRealTimers()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('stops polling when no active operations', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        operations: [{ ...mockOperations[0], status: 'completed' }],
      }),
    })

    renderHook(() => useOperations())

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    // Fast-forward time - should not trigger additional polling
    vi.useFakeTimers()
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    vi.useRealTimers()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes operations manually', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    const { result } = renderHook(() => useOperations())

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await result.current.refreshOperations()
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})
