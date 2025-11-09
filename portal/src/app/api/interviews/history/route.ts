import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'

/**
 * Gets historical (completed/destroyed) interviews from DynamoDB.
 *
 * This endpoint provides access to completed interviews for history tracking
 * and reporting purposes. It uses DynamoDB's GSI for efficient querying of
 * historical records by status.
 *
 * **Query Parameters:**
 * - `limit`: Maximum number of historical interviews to return (default: 50, max: 100)
 * - `candidate`: Filter by candidate name (optional)
 *
 * **Performance:**
 * - Uses DynamoDB GSI queries for fast retrieval
 * - Automatically sorted by completion date (newest first)
 * - TTL ensures automatic cleanup after 90 days
 *
 * @param request - NextRequest with optional query parameters
 * @returns JSON response with historical interviews array
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const candidateParam = searchParams.get('candidate')

    // Parse and validate limit parameter
    let limit = 50 // Default limit
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10)
      if (!isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100) {
        limit = parsedLimit
      }
    }

    let historicalInterviews

    if (candidateParam) {
      // Search by candidate name if provided
      historicalInterviews = await interviewManager.searchByCandidate(
        candidateParam,
        limit
      )
      // Filter to only historical statuses
      historicalInterviews = historicalInterviews.filter(
        interview =>
          interview.status === 'destroyed' || interview.status === 'error'
      )
    } else {
      // Get all historical interviews
      historicalInterviews =
        await interviewManager.getHistoricalInterviews(limit)
    }

    // Convert to API format
    const formattedInterviews = historicalInterviews.map(interview => ({
      id: interview.id,
      type: interview.type || 'regular', // Include type field for filtering
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      status: interview.status,
      accessUrl: interview.accessUrl,
      password: interview.password,
      createdAt: interview.createdAt.toISOString(),
      scheduledAt: interview.scheduledAt?.toISOString(),
      autoDestroyAt: interview.autoDestroyAt?.toISOString(),
      completedAt: interview.completedAt?.toISOString(),
      destroyedAt: interview.destroyedAt?.toISOString(),
      historyS3Key: interview.historyS3Key,
      saveFiles: interview.saveFiles,
    }))

    console.log(
      `[DEBUG] Retrieved ${historicalInterviews.length} historical interviews from DynamoDB` +
        (candidateParam ? ` for candidate: ${candidateParam}` : '')
    )

    return NextResponse.json({
      interviews: formattedInterviews,
      total: formattedInterviews.length,
      limit,
      hasMore: formattedInterviews.length === limit, // Indicates if there might be more results
    })
  } catch (error: unknown) {
    console.error('Error listing historical interviews:', error)

    return NextResponse.json(
      {
        error: 'Failed to retrieve historical interviews',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
