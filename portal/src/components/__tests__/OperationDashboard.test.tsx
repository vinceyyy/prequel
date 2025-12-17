import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import OperationDashboard from '../OperationDashboard'

// Mock fetch globally (for log fetching)
global.fetch = jest.fn()

const mockOperations = [
  {
    id: 'op-1',
    type: 'create' as const,
    status: 'completed' as const,
    interviewId: 'int-1',
    candidateName: 'John Doe',
    challenge: 'javascript',
    createdAt: '2024-01-01T10:00:00Z',
    executionStartedAt: '2024-01-01T10:00:00Z',
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
    candidateName: 'Jane Smith',
    challenge: 'python',
    createdAt: '2024-01-01T11:00:00Z',
    executionStartedAt: '2024-01-01T11:00:00Z',
  },
]

const mockLogs = ['Log line 1', 'Log line 2', 'Log line 3']

describe('OperationDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders with operations passed as props', () => {
    render(<OperationDashboard operations={mockOperations} />)

    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Create Interview')).toBeInTheDocument()
    expect(screen.getByText('Destroy Interview')).toBeInTheDocument()
  })

  it('displays candidate names and challenges', () => {
    render(<OperationDashboard operations={mockOperations} />)

    expect(screen.getByText(/John Doe/)).toBeInTheDocument()
    expect(screen.getByText(/Jane Smith/)).toBeInTheDocument()
    expect(screen.getByText(/javascript/)).toBeInTheDocument()
    expect(screen.getByText(/python/)).toBeInTheDocument()
  })

  it('displays correct status icons', () => {
    render(<OperationDashboard operations={mockOperations} />)

    expect(screen.getByText('✅')).toBeInTheDocument() // completed status
    expect(screen.getByText('🔄')).toBeInTheDocument() // running status
  })

  it('displays scheduled status icon', () => {
    const scheduledOperation = {
      ...mockOperations[0],
      id: 'op-scheduled',
      status: 'scheduled' as const,
    }

    render(<OperationDashboard operations={[scheduledOperation]} />)

    expect(screen.getByText('📅')).toBeInTheDocument()
  })

  it('loads and displays logs when operation is selected', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ logs: mockLogs }),
    })

    render(<OperationDashboard operations={mockOperations} />)

    // Click on first operation
    fireEvent.click(screen.getByText('Create Interview'))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/operations/op-1/logs')
    })

    await waitFor(() => {
      expect(screen.getByText(/Log line 1/)).toBeInTheDocument()
    })
  })

  it('polls logs for active operations at 1-second interval', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ logs: mockLogs }),
    })

    render(<OperationDashboard operations={mockOperations} />)

    // Click on running operation
    fireEvent.click(screen.getByText('Destroy Interview'))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/operations/op-2/logs')
    })

    // Fast-forward time to trigger log polling
    jest.advanceTimersByTime(1000)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('shows access URL link when available', () => {
    render(<OperationDashboard operations={[mockOperations[0]]} />)

    const accessLink = screen.getByText('🔗 Access Interview')
    expect(accessLink).toBeInTheDocument()
    expect(accessLink.closest('a')).toHaveAttribute(
      'href',
      'https://example.com/interview/int-1'
    )
  })

  it('calls onRefresh when refresh button is clicked', () => {
    const mockRefresh = jest.fn()

    render(
      <OperationDashboard operations={mockOperations} onRefresh={mockRefresh} />
    )

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refreshButton)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('hides refresh button when onRefresh is not provided', () => {
    render(<OperationDashboard operations={mockOperations} />)

    expect(
      screen.queryByRole('button', { name: 'Refresh' })
    ).not.toBeInTheDocument()
  })

  it('handles log fetch errors gracefully', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    render(<OperationDashboard operations={mockOperations} />)

    // Click on first operation
    fireEvent.click(screen.getByText('Create Interview'))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load operation logs:',
        expect.any(Error)
      )
    })

    consoleSpy.mockRestore()
  })

  it('displays empty state when no operations exist', () => {
    render(<OperationDashboard operations={[]} />)

    expect(screen.getByText('No operations found')).toBeInTheDocument()
  })

  it('formats duration correctly', () => {
    const operationWithDuration = {
      ...mockOperations[0],
      executionStartedAt: '2024-01-01T10:00:00Z',
      completedAt: '2024-01-01T10:01:30Z', // 1 minute 30 seconds
    }

    render(<OperationDashboard operations={[operationWithDuration]} />)

    expect(screen.getByText(/Duration: 1m 30s/)).toBeInTheDocument()
  })

  it('calls onRefresh after cancelling operation', async () => {
    const mockRefresh = jest.fn()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const runningOperation = {
      ...mockOperations[1],
      status: 'running' as const,
    }

    render(
      <OperationDashboard
        operations={[runningOperation]}
        onRefresh={mockRefresh}
      />
    )

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/operations/op-2/cancel', {
        method: 'POST',
      })
    })

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })
})
