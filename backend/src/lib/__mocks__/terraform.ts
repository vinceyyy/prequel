import { vi } from 'vitest'

export const terraformManager = {
  listActiveInterviews: vi.fn(),
  getInterviewStatus: vi.fn(),
  createInterviewStreaming: vi.fn(),
  destroyInterview: vi.fn(),
  destroyInterviewStreaming: vi.fn().mockResolvedValue({
    success: true,
    output: 'Mock destroy output',
    historyS3Key: 'mock-interview-123/2025-01-19T12-00-00-000Z/workspace-files.tar.gz',
  }),
}
