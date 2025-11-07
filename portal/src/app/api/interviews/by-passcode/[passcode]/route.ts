import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'

/**
 * GET /api/interviews/by-passcode/[passcode]
 *
 * Returns interview details for a given passcode (take-home tests).
 * Used by candidate page to fetch test details and status.
 *
 * @param request - NextRequest object
 * @param params - Route parameters containing passcode
 * @returns JSON response with interview data or error
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    if (!passcode || passcode.length !== 8) {
      return NextResponse.json(
        { error: 'Invalid passcode format' },
        { status: 400 }
      )
    }

    const interview = await interviewManager.getInterviewByPasscode(passcode)

    if (!interview) {
      return NextResponse.json(
        { error: 'Take-home test not found or expired' },
        { status: 404 }
      )
    }

    // Verify it's a take-home test
    if (interview.type !== 'take-home') {
      return NextResponse.json({ error: 'Invalid passcode' }, { status: 404 })
    }

    return NextResponse.json(interview)
  } catch (error) {
    console.error('Error fetching interview by passcode:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
