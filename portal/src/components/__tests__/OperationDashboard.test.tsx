import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import OperationDashboard from '../OperationDashboard'

// Mock fetch globally
global.fetch = jest.fn()

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
    logs: ['Destroying resources...'],
  },
]

const mockLogs = ['Log line 1', 'Log line 2', 'Log line 3']

describe('OperationDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock timers for polling intervals
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders loading state initially', () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [] }),
    })

    render(<OperationDashboard />)

    expect(screen.getByText('All Operations')).toBeInTheDocument()
  })

  it('loads and displays operations', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getByText('Create Interview')).toBeInTheDocument()
      expect(screen.getByText('Destroy Interview')).toBeInTheDocument()
    })

    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
  })

  it('filters operations by interview ID when interviewFilter prop is provided', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    render(<OperationDashboard interviewFilter="int-1" />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/operations?interviewId=int-1'
      )
    })

    expect(
      screen.getByText('Operations for Interview int-1')
    ).toBeInTheDocument()
  })

  it('displays correct status icons and colors', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
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
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operations: mockOperations }),
      })
      .mockResolvedValueOnce({
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
      expect(global.fetch).toHaveBeenCalledWith('/api/operations/op-1/logs')
    })

    await waitFor(() => {
      expect(screen.getByText('Log line 1')).toBeInTheDocument()
    })
  })

  it('polls operations when there are active operations', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/operations')
    })

    // Fast-forward time to trigger polling
    jest.advanceTimersByTime(3000)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('shows access URL link when available', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [mockOperations[0]] }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      const accessLink = screen.getByText('🔗 Access Interview')
      expect(accessLink).toBeInTheDocument()
      expect(accessLink.closest('a')).toHaveAttribute(
        'href',
        'https://example.com/interview/int-1'
      )
    })
  })

  it('refreshes operations when refresh button is clicked', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ operations: mockOperations }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('handles API errors gracefully', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load operations:',
        expect.any(Error)
      )
    })

    consoleSpy.mockRestore()
  })

  it('displays empty state when no operations exist', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
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
      startedAt: '2024-01-01T10:00:00Z',
      completedAt: '2024-01-01T10:01:30Z', // 1 minute 30 seconds
    }

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ operations: [operationWithDuration] }),
    })

    render(<OperationDashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Duration: 1m 30s/)).toBeInTheDocument()
    })
  })
})
