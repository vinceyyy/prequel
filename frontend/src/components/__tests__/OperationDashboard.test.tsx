import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { Mock } from 'vitest'
import OperationDashboard from '../OperationDashboard'

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
    executionStartedAt: '2024-01-01T10:00:00Z',
    completedAt: '2024-01-01T10:05:00Z',
    logs: ['Starting operation...', 'Operation completed successfully'],
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
    candidateName: 'Jane Smith',
    challenge: 'python',
    startedAt: '2024-01-01T11:00:00Z',
    executionStartedAt: '2024-01-01T11:00:00Z',
    logs: ['Destroying resources...'],
  },
]

const mockLogs = ['Log line 1', 'Log line 2', 'Log line 3']

describe('OperationDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders loading state initially', () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [] }),
    })

    render(<OperationDashboard />)

    expect(screen.getByText('All Operations')).toBeInTheDocument()
  })

  it('loads and displays operations', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getAllByText('Create Interview').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Destroy Interview').length).toBeGreaterThan(0)
    })

    expect(screen.getByText(/John Doe/)).toBeInTheDocument()
    expect(screen.getByText(/Jane Smith/)).toBeInTheDocument()
  })

  it('filters operations by interview ID when interviewFilter prop is provided', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    render(<OperationDashboard interviewFilter="int-1" />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/operations?interviewId=int-1')
    })

    expect(screen.getByText('Operations for Interview int-1')).toBeInTheDocument()
  })

  it('displays correct status icons and colors', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getByText('✅')).toBeInTheDocument() // completed status
      expect(screen.getByText('🔄')).toBeInTheDocument() // running status
    })
  })

  it('loads and displays logs when operation is selected', async () => {
    ;(globalThis.fetch as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: [mockOperations[0]] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ logs: mockLogs }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ logs: mockLogs }),
      })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getByText('Create Interview')).toBeInTheDocument()
    })

    // Click on first operation
    fireEvent.click(screen.getByText('Create Interview'))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/operations/op-1/logs')
    })

    await waitFor(() => {
      expect(screen.getByText(/Log line 1/)).toBeInTheDocument()
    })
  })

  it('polls operations when there are active operations', async () => {
    // op-2 is "running", so the dashboard sets up a 3s polling interval.
    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    // Use fake timers from the start so the polling interval registered by the
    // component is driven deterministically (advanceTimersByTimeAsync also
    // flushes the promise microtasks queued by fetch).
    vi.useFakeTimers()
    try {
      render(<OperationDashboard />)

      // Flush the initial load (fetch + state update) so the polling effect runs.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/operations')
      const callsBefore = (globalThis.fetch as Mock).mock.calls.length

      // Advance past the 3s polling interval to trigger another load.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect((globalThis.fetch as Mock).mock.calls.length).toBeGreaterThan(callsBefore)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows access URL link when available', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      const accessLink = screen.getByText('🔗 Access Interview')
      expect(accessLink).toBeInTheDocument()
      expect(accessLink.closest('a')).toHaveAttribute('href', 'https://example.com/interview/int-1')
    })
  })

  it('refreshes operations when refresh button is clicked', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('handles API errors gracefully', async () => {
    ;(globalThis.fetch as Mock).mockRejectedValueOnce(new Error('API Error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load operations:', expect.any(Error))
    })

    consoleSpy.mockRestore()
  })

  it('displays empty state when no operations exist', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [] }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getByText('No operations found')).toBeInTheDocument()
    })
  })

  it('formats duration correctly', async () => {
    const operationWithDuration = {
      ...mockOperations[0],
      executionStartedAt: '2024-01-01T10:00:00Z',
      completedAt: '2024-01-01T10:01:30Z', // 1 minute 30 seconds
    }

    ;(globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [operationWithDuration] }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Duration: 1m 30s/)).toBeInTheDocument()
    })
  })
})
