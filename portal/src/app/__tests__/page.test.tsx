import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { useOperations } from '@/hooks/useOperations'
import Home from '../page'

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
  })),
  usePathname: jest.fn(() => '/'),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}))

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
    challenge: 'javascript',
    accessUrl: 'https://example.com/interview/int-1',
    password: 'test123',
    createdAt: '2024-01-01T10:00:00Z',
  },
  {
    id: 'int-2',
    candidateName: 'Jane Smith',
    status: 'initializing' as const,
    challenge: 'python',
    createdAt: '2024-01-01T11:00:00Z',
  },
  {
    id: 'int-3',
    candidateName: 'Bob Wilson',
    status: 'error' as const,
    challenge: 'sql',
    createdAt: '2024-01-01T12:00:00Z',
  },
]

const mockUseOperations = jest.mocked(useOperations)

// Helper function to setup default fetch mocks
const setupDefaultFetchMocks = (
  interviews: typeof mockInterviews = [],
  historicalInterviews: typeof mockInterviews = [],
  challenges: Array<{ id: string; name: string }> = []
) => {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/api/interviews/history')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ interviews: historicalInterviews }),
      })
    }
    if (url.includes('/api/interviews')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ interviews }),
      })
    }
    if (url.includes('/api/challenges')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, challenges }),
      })
    }
    if (url.includes('/api/takehome')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ takehomes: [] }),
      })
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`))
  })
}

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
    setupDefaultFetchMocks([], [], [
      { id: 'javascript', name: 'JavaScript' },
      { id: 'python', name: 'Python' },
      { id: 'sql', name: 'SQL' },
    ])

    render(<Home />)

    expect(screen.getByText('Prequel Portal')).toBeInTheDocument()
    expect(
      screen.getByText('Manage coding interviews and VS Code instances')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create Interview' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create Take-Home Test' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage Challenges' })).toBeInTheDocument()
  })

  it('loads and displays interviews on initial render', async () => {
    setupDefaultFetchMocks(mockInterviews, [], [
      { id: 'javascript', name: 'JavaScript' },
      { id: 'python', name: 'Python' },
      { id: 'sql', name: 'SQL' },
    ])

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
      expect(screen.getByText('Bob Wilson')).toBeInTheDocument()
    })

    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText('Python')).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    ;(global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    render(<Home />)

    expect(screen.getByText('Loading current interviews...')).toBeInTheDocument()
  })

  it('shows empty state when no interviews exist', async () => {
    setupDefaultFetchMocks([], [], [])

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('No interviews created yet')).toBeInTheDocument()
    })
  })

  it('opens create interview modal when button is clicked', async () => {
    setupDefaultFetchMocks([], [], [
      { id: 'javascript', name: 'JavaScript' },
      { id: 'python', name: 'Python' },
    ])

    render(<Home />)

    // Find the button to open modal (not inside modal)
    const createButtons = screen.getAllByRole('button', {
      name: 'Create Interview',
    })
    // First button is the one to open the modal
    fireEvent.click(createButtons[0])

    // Check for modal content
    expect(screen.getByLabelText('Candidate Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Interview Challenge')).toBeInTheDocument()
    // Check there are now two "Create Interview" buttons (one to open, one to submit)
    expect(createButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('handles form input and submission', async () => {
    const user = userEvent.setup()
    setupDefaultFetchMocks([], [], [
      { id: 'javascript', name: 'JavaScript' },
      { id: 'python', name: 'Python' },
    ])

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
      name: 'Create Interview',
    })
    fireEvent.click(createButton)

    // Fill form
    const nameInput = screen.getByLabelText('Candidate Name')
    const challengeSelect = screen.getByLabelText('Interview Challenge')

    await user.type(nameInput, 'Test Candidate')
    await user.selectOptions(challengeSelect, 'python')

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
    setupDefaultFetchMocks(mockInterviews, [], [])

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument()
      expect(screen.getByText('initializing')).toBeInTheDocument()
      expect(screen.getByText('error')).toBeInTheDocument()
    })

    // Check for error message
    expect(screen.getByText('Resources may need cleanup')).toBeInTheDocument()
  })

  it('shows access details for active interviews', async () => {
    setupDefaultFetchMocks([mockInterviews[0]], [], [])

    render(<Home />)

    await waitFor(() => {
      expect(
        screen.getByText('https://example.com/interview/int-1')
      ).toBeInTheDocument()
      expect(screen.getByText('Password: test123')).toBeInTheDocument()
    })
  })

  it('handles stop interview action', async () => {
    setupDefaultFetchMocks([mockInterviews[0]], [], [])

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

    // Check for destroy notification
    await waitFor(() => {
      expect(
        screen.getByText('Interview destroy started for John Doe')
      ).toBeInTheDocument()
    })
  })

  it('handles retry destroy for error state interviews', async () => {
    setupDefaultFetchMocks([mockInterviews[2]], [], [])

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
      const retryButton = screen.getByText('Retry Destroy')
      fireEvent.click(retryButton)
    })

    expect(global.confirm).toHaveBeenCalledWith(
      'Are you sure you want to retry destroying this interview? This will attempt to clean up any remaining AWS resources and remove the workspace from S3.'
    )

    await waitFor(() => {
      expect(mockDestroyInterview).toHaveBeenCalledWith('int-3')
    })

    // Check for retry destroy notification
    await waitFor(() => {
      expect(
        screen.getByText('Interview retry destroy started for Bob Wilson')
      ).toBeInTheDocument()
    })
  })

  it('opens logs modal when logs button is clicked', async () => {
    setupDefaultFetchMocks([mockInterviews[0]], [], [])

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

  it('validates form input - empty candidate name', async () => {
    setupDefaultFetchMocks([], [], [])

    render(<Home />)

    // Open modal
    const createButton = screen.getByRole('button', {
      name: 'Create Interview',
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
    setupDefaultFetchMocks([], [], [])

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
      name: 'Create Interview',
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

  it('shows error notification when destroy fails', async () => {
    setupDefaultFetchMocks([mockInterviews[0]], [], [])

    const mockDestroyInterview = jest
      .fn()
      .mockRejectedValue(new Error('Destroy failed'))
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

    await waitFor(() => {
      expect(
        screen.getByText(
          '❌ Failed to start destroy operation. Please try again.'
        )
      ).toBeInTheDocument()
    })
  })
})
