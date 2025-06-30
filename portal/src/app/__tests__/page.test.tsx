import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import Home from '../page'

// Mock the hooks and components
jest.mock('@/hooks/useOperations', () => ({
  useOperations: jest.fn(() => ({
    createInterview: jest.fn().mockResolvedValue({}),
    destroyInterview: jest.fn().mockResolvedValue({}),
  })),
}))

jest.mock('@/components/OperationDashboard', () => {
  return function MockOperationDashboard({
    interviewFilter,
  }: {
    interviewFilter?: string | null
  }) {
    return (
      <div data-testid="operation-dashboard">
        Mock Dashboard {interviewFilter}
      </div>
    )
  }
})

// Mock fetch globally
global.fetch = jest.fn()

const mockInterviews = [
  {
    id: 'int-1',
    candidateName: 'John Doe',
    status: 'active' as const,
    scenario: 'javascript',
    accessUrl: 'https://example.com/interview/int-1',
    password: 'test123',
    createdAt: '2024-01-01T10:00:00Z',
  },
  {
    id: 'int-2',
    candidateName: 'Jane Smith',
    status: 'creating' as const,
    scenario: 'python',
    createdAt: '2024-01-01T11:00:00Z',
  },
  {
    id: 'int-3',
    candidateName: 'Bob Wilson',
    status: 'error' as const,
    scenario: 'sql',
    createdAt: '2024-01-01T12:00:00Z',
  },
]

const mockUseOperations = jest.mocked(
  require('@/hooks/useOperations').useOperations
)

describe('Home Page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock window.confirm
    global.confirm = jest.fn(() => true)
    global.alert = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders the main page with title and header', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [] }),
    })

    render(<Home />)

    expect(screen.getByText('Prequel Portal')).toBeInTheDocument()
    expect(
      screen.getByText('Manage coding interviews and VS Code instances')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create New Interview' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('loads and displays interviews on initial render', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: mockInterviews }),
    })

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
      expect(screen.getByText('Bob Wilson')).toBeInTheDocument()
    })

    expect(screen.getByText('JavaScript/React')).toBeInTheDocument()
    expect(screen.getByText('Python/Data Science')).toBeInTheDocument()
    expect(screen.getByText('SQL/Database')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    ;(global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    render(<Home />)

    expect(screen.getByText('Loading interviews...')).toBeInTheDocument()
  })

  it('shows empty state when no interviews exist', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [] }),
    })

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('No interviews created yet')).toBeInTheDocument()
    })
  })

  it('opens create interview modal when button is clicked', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [] }),
    })

    render(<Home />)

    const createButton = screen.getByRole('button', {
      name: 'Create New Interview',
    })
    fireEvent.click(createButton)

    expect(screen.getByText('Create New Interview')).toBeInTheDocument()
    expect(screen.getByLabelText('Candidate Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Interview Scenario')).toBeInTheDocument()
  })

  it('handles form input and submission', async () => {
    const user = userEvent.setup()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [] }),
    })

    const mockCreateInterview = jest.fn().mockResolvedValue({})
    mockUseOperations.mockReturnValue({
      createInterview: mockCreateInterview,
      destroyInterview: jest.fn(),
      operations: [],
      loading: false,
      refreshOperations: jest.fn(),
    })

    render(<Home />)

    // Open modal
    const createButton = screen.getByRole('button', {
      name: 'Create New Interview',
    })
    fireEvent.click(createButton)

    // Fill form
    const nameInput = screen.getByLabelText('Candidate Name')
    const scenarioSelect = screen.getByLabelText('Interview Scenario')

    await user.type(nameInput, 'Test Candidate')
    await user.selectOptions(scenarioSelect, 'python')

    // Submit form
    const submitButton = screen.getByRole('button', {
      name: 'Create Interview',
    })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockCreateInterview).toHaveBeenCalledWith(
        'Test Candidate',
        'python'
      )
    })
  })

  it('displays different status badges correctly', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: mockInterviews }),
    })

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument()
      expect(screen.getByText('creating')).toBeInTheDocument()
      expect(screen.getByText('error')).toBeInTheDocument()
    })

    // Check for error message
    expect(screen.getByText('Resources may need cleanup')).toBeInTheDocument()
  })

  it('shows access details for active interviews', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [mockInterviews[0]] }),
    })

    render(<Home />)

    await waitFor(() => {
      expect(
        screen.getByText('https://example.com/interview/int-1')
      ).toBeInTheDocument()
      expect(screen.getByText('Password: test123')).toBeInTheDocument()
    })
  })

  it('handles stop interview action', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [mockInterviews[0]] }),
    })

    const mockDestroyInterview = jest.fn().mockResolvedValue({})
    mockUseOperations.mockReturnValue({
      createInterview: jest.fn(),
      destroyInterview: mockDestroyInterview,
      operations: [],
      loading: false,
      refreshOperations: jest.fn(),
    })

    render(<Home />)

    await waitFor(() => {
      const stopButton = screen.getByText('Stop & Destroy')
      fireEvent.click(stopButton)
    })

    expect(global.confirm).toHaveBeenCalledWith(
      'Are you sure you want to stop and destroy this interview? This action cannot be undone.'
    )

    await waitFor(() => {
      expect(mockDestroyInterview).toHaveBeenCalledWith('int-1')
    })
  })

  it('handles retry destroy for error state interviews', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [mockInterviews[2]] }),
    })

    render(<Home />)

    await waitFor(() => {
      const retryButton = screen.getByText('Retry Destroy')
      fireEvent.click(retryButton)
    })

    expect(global.confirm).toHaveBeenCalledWith(
      'Are you sure you want to retry destroying this interview? This will attempt to clean up any remaining AWS resources and remove the workspace from S3.'
    )
  })

  it('opens logs modal when logs button is clicked', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [mockInterviews[0]] }),
    })

    render(<Home />)

    await waitFor(() => {
      const logsButton = screen.getByText('Logs')
      fireEvent.click(logsButton)
    })

    expect(
      screen.getByText('Operation Logs - Interview int-1')
    ).toBeInTheDocument()
    expect(screen.getByTestId('operation-dashboard')).toBeInTheDocument()
  })

  it('refreshes interviews when refresh button is clicked', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ interviews: mockInterviews }),
    })

    render(<Home />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    const refreshButton = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('validates form input - empty candidate name', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [] }),
    })

    render(<Home />)

    // Open modal
    const createButton = screen.getByRole('button', {
      name: 'Create New Interview',
    })
    fireEvent.click(createButton)

    // Try to submit without entering name
    const submitButton = screen.getByRole('button', {
      name: 'Create Interview',
    })
    expect(submitButton).toBeDisabled()
  })

  it('shows notification after creating interview', async () => {
    jest.useFakeTimers()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ interviews: [] }),
    })

    const mockCreateInterview = jest.fn().mockResolvedValue({})
    mockUseOperations.mockReturnValue({
      createInterview: mockCreateInterview,
      destroyInterview: jest.fn(),
      operations: [],
      loading: false,
      refreshOperations: jest.fn(),
    })

    render(<Home />)

    // Open modal and fill form
    const createButton = screen.getByRole('button', {
      name: 'Create New Interview',
    })
    fireEvent.click(createButton)

    const nameInput = screen.getByLabelText('Candidate Name')
    fireEvent.change(nameInput, { target: { value: 'Test User' } })

    const submitButton = screen.getByRole('button', {
      name: 'Create Interview',
    })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(
        screen.getByText('Interview creation started for Test User')
      ).toBeInTheDocument()
    })

    // Fast forward to clear notification
    jest.advanceTimersByTime(5000)

    await waitFor(() => {
      expect(
        screen.queryByText('Interview creation started for Test User')
      ).not.toBeInTheDocument()
    })

    jest.useRealTimers()
  })
})
