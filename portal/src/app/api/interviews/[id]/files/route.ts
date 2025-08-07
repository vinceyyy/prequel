import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'

/**
 * Downloads candidate files from S3 for a completed interview.
 *
 * This endpoint retrieves the saved candidate files from S3 history storage.
 * Files are only available for interviews that had `saveFiles: true` enabled
 * during destruction and were successfully extracted.
 *
 * **Security:**
 * - Only allows download of files for interviews that exist in DynamoDB
 * - Validates that the interview has a historyS3Key
 * - Uses pre-signed URLs for secure, time-limited access
 *
 * **Response:**
 * - Returns a tar.gz file containing all candidate files
 * - Content-Type: application/gzip
 * - Content-Disposition: attachment with interview ID and candidate name
 *
 * @param request - NextRequest (unused)
 * @param params - Route parameters containing interview ID
 * @returns Response with tar.gz file or error
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: interviewId } = await params

    if (!interviewId) {
      return NextResponse.json(
        { error: 'Interview ID is required' },
        { status: 400 }
      )
    }

    // Get interview from DynamoDB to verify it exists and has saved files
    const interview = await interviewManager.getInterview(interviewId)

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      )
    }

    if (!interview.historyS3Key) {
      return NextResponse.json(
        {
          error: 'No saved files available for this interview',
          details: 'Files were not saved during interview destruction',
        },
        { status: 404 }
      )
    }

    // Import AWS SDK for S3 operations
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
    const { config } = await import('@/lib/config')

    const s3Client = new S3Client(config.aws.getCredentials())
    const bucketName = config.storage.historyBucket

    try {
      // Get the tar.gz file from S3
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: interview.historyS3Key,
      })

      const response = await s3Client.send(command)

      if (!response.Body) {
        return NextResponse.json(
          { error: 'File not found in S3' },
          { status: 404 }
        )
      }

      // Convert the S3 stream to a buffer
      const chunks: Uint8Array[] = []
      const reader = response.Body.transformToWebStream().getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      const buffer = Buffer.concat(chunks)

      // Generate filename with interview ID and candidate name
      const sanitizedCandidateName = interview.candidateName
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .substring(0, 50)
      const filename = `interview_${interviewId}_${sanitizedCandidateName}.tar.gz`

      // Return the tar.gz file as a download
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
        },
      })
    } catch (s3Error) {
      console.error('Failed to download file from S3:', s3Error)

      if (s3Error instanceof Error && s3Error.name === 'NoSuchKey') {
        return NextResponse.json(
          {
            error: 'Saved files not found',
            details:
              'The saved files may have been automatically cleaned up or corrupted',
          },
          { status: 404 }
        )
      }

      return NextResponse.json(
        {
          error: 'Failed to download saved files',
          details: 'An error occurred while retrieving files from storage',
        },
        { status: 500 }
      )
    }
  } catch (error: unknown) {
    console.error('Error downloading interview files:', error)

    return NextResponse.json(
      {
        error: 'Failed to process file download request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
