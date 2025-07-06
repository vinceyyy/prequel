import { GET } from '../route'

// Mock AWS S3 client
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  ListObjectsV2Command: jest.fn(),
}))

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

const mockS3Client = jest.mocked(new S3Client({}))
const mockListObjectsV2Command = jest.mocked(ListObjectsV2Command)

describe('/api/challenges', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET', () => {
    it('returns challenges from S3 bucket', async () => {
      const mockS3Response = {
        CommonPrefixes: [
          { Prefix: 'javascript/' },
          { Prefix: 'python/' },
          { Prefix: 'sql/' },
        ],
      }

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.challenges).toHaveLength(3)
      expect(data.challenges).toEqual([
        { id: 'javascript', name: 'Javascript' },
        { id: 'python', name: 'Python' },
        { id: 'sql', name: 'Sql' },
      ])
    })

    it('handles hyphenated challenge names correctly', async () => {
      const mockS3Response = {
        CommonPrefixes: [
          { Prefix: 'data-science/' },
          { Prefix: 'full-stack-web/' },
          { Prefix: 'react-typescript/' },
        ],
      }

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.challenges).toEqual([
        { id: 'data-science', name: 'Data Science' },
        { id: 'full-stack-web', name: 'Full Stack Web' },
        { id: 'react-typescript', name: 'React Typescript' },
      ])
    })

    it('sorts challenges alphabetically', async () => {
      const mockS3Response = {
        CommonPrefixes: [
          { Prefix: 'python/' },
          { Prefix: 'javascript/' },
          { Prefix: 'sql/' },
        ],
      }

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.challenges.map((c: { name: string }) => c.name)).toEqual([
        'Javascript',
        'Python',
        'Sql',
      ])
    })

    it('handles empty S3 bucket', async () => {
      const mockS3Response = {
        CommonPrefixes: [],
      }

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.challenges).toHaveLength(0)
    })

    it('handles S3 bucket with no CommonPrefixes', async () => {
      const mockS3Response = {}

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.challenges).toHaveLength(0)
    })

    it('handles S3 errors gracefully', async () => {
      const s3Error = new Error('S3 access denied')
      mockS3Client.send = jest.fn().mockRejectedValue(s3Error)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Failed to fetch challenges from S3')
      expect(data.challenges).toEqual([])
    })

    it('calls S3 with correct parameters', async () => {
      const mockS3Response = {
        CommonPrefixes: [{ Prefix: 'javascript/' }],
      }

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      await GET()

      expect(mockListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'prequel-challenge',
        Delimiter: '/',
      })
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(mockListObjectsV2Command)
      )
    })

    it('filters out invalid prefixes', async () => {
      const mockS3Response = {
        CommonPrefixes: [
          { Prefix: 'javascript/' },
          { Prefix: null }, // Invalid prefix
          { Prefix: 'python/' },
          { Prefix: '' }, // Empty prefix
        ],
      }

      mockS3Client.send = jest.fn().mockResolvedValue(mockS3Response)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.challenges).toHaveLength(2)
      expect(data.challenges.map((c: { id: string }) => c.id)).toEqual([
        'javascript',
        'python',
      ])
    })
  })
})
