import { interviewManager } from '../interviews'

describe('Interview with OpenAI service account', () => {
  it('should store service account ID and API key', async () => {
    // Mock DynamoDB client to avoid actual DB calls in unit tests
    const mockSend = jest.fn()

    // Store original client to restore later
    const originalClient = (
      interviewManager as unknown as { dynamoClient: unknown }
    ).dynamoClient

    // Mock DynamoDB PutItemCommand response
    mockSend.mockResolvedValueOnce({})
    ;(
      interviewManager as unknown as { dynamoClient: { send: jest.Mock } }
    ).dynamoClient = { send: mockSend }

    const interview = await interviewManager.createInterview({
      id: 'test-123',
      candidateName: 'Test User',
      challenge: 'javascript',
      status: 'initializing',
      openaiServiceAccountId: 'svc_acct_abc',
      openaiApiKey: 'sk-test123',
    })

    expect(interview.openaiServiceAccountId).toBe('svc_acct_abc')
    expect(interview.openaiApiKey).toBe('sk-test123')

    // Restore original client
    ;(interviewManager as unknown as { dynamoClient: unknown }).dynamoClient =
      originalClient
  })
})
