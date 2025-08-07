import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { logger } from '@/lib/logger'

/**
 * Deletes a historical interview record and associated S3 files.
 *
 * This endpoint permanently removes an interview from DynamoDB and deletes
 * any associated history files from S3. This is typically used for cleanup
 * of old interview records in the History tab.
 *
 * @param request - NextRequest (unused for DELETE)
 * @param params - Route parameters containing interview ID
 * @returns JSON response confirming deletion or error details
 */
export async function DELETE(
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

    logger.info(`[API] Deleting interview record: ${interviewId}`)

    // Get the interview to check if it has history files
    const interview = await interviewManager.getInterview(interviewId)

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      )
    }

    // Only allow deletion of completed interviews (destroyed or error status)
    if (interview.status !== 'destroyed' && interview.status !== 'error') {
      return NextResponse.json(
        {
          error: 'Cannot delete active interview',
          details:
            'Only completed interviews (destroyed or error) can be deleted',
        },
        { status: 400 }
      )
    }

    // Delete history files from S3 if they exist
    if (interview.historyS3Key) {
      logger.info(`[API] Deleting history files: ${interview.historyS3Key}`)

      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        const { config } = await import('@/lib/config')

        await execAsync(
          `aws s3 rm "s3://${config.storage.historyBucket}/${interview.historyS3Key}" --recursive`,
          {
            env: process.env as NodeJS.ProcessEnv,
            timeout: 30000,
          }
        )

        logger.info(
          `[API] Successfully deleted history files: ${interview.historyS3Key}`
        )
      } catch (s3Error) {
        logger.warn(`[API] Failed to delete history files: ${s3Error}`)
        // Continue with DynamoDB deletion even if S3 cleanup fails
      }
    }

    // Delete the interview record from DynamoDB
    await interviewManager.deleteInterview(interviewId)

    logger.info(`[API] Successfully deleted interview: ${interviewId}`)

    return NextResponse.json({
      success: true,
      message: 'Interview deleted successfully',
      deletedHistoryFiles: !!interview.historyS3Key,
    })
  } catch (error) {
    logger.error(
      `[API] Error deleting interview: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return NextResponse.json(
      {
        error: 'Failed to delete interview',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
