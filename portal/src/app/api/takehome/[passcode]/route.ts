import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'

/**
 * Gets a take-home test by passcode.
 *
 * DEPRECATED: Use /api/interviews/by-passcode/[passcode] instead.
 * This endpoint is maintained for backward compatibility.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response with take-home test data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    const interview = await interviewManager.getInterviewByPasscode(passcode)

    if (!interview || interview.type !== 'take-home') {
      return NextResponse.json(
        { error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      passcode: interview.passcode,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      customInstructions: interview.customInstructions,
      status: interview.status,
      validUntil:
        typeof interview.validUntil === 'string'
          ? interview.validUntil
          : interview.validUntil?.toISOString(),
      durationMinutes: interview.durationMinutes,
    })
  } catch (error) {
    console.error('Error getting take-home test:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
