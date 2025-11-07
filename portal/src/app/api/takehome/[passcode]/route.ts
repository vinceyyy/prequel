import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'

/**
 * Gets a take-home test by passcode.
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

    const takehome = await takehomeManager.getTakehome(passcode)

    if (!takehome) {
      return NextResponse.json(
        { error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      passcode: takehome.passcode,
      candidateName: takehome.candidateName,
      challenge: takehome.challenge,
      customInstructions: takehome.customInstructions,
      status: takehome.status,
      validUntil:
        typeof takehome.validUntil === 'string'
          ? takehome.validUntil
          : takehome.validUntil.toISOString(),
      durationMinutes: takehome.durationMinutes,
    })
  } catch (error) {
    console.error('Error getting take-home test:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
