export const terraformManager = {
  listActiveInterviews: jest.fn(),
  getInterviewStatus: jest.fn(),
  createInterviewStreaming: jest.fn(),
  destroyInterview: jest.fn(),
  destroyInterviewStreaming: jest.fn().mockResolvedValue({
    success: true,
    output: 'Mock destroy output',
    historyS3Key:
      'mock-interview-123/2025-01-19T12-00-00-000Z/workspace-files.tar.gz',
  }),
}
