import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'
import { config } from '@/lib/config'

/**
 * Creates a new take-home test invitation.
 *
 * @param request - NextRequest with take-home test parameters
 * @returns JSON response with passcode and URL
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      candidateName,
      challenge,
      customInstructions,
      availabilityWindowDays = 7,
      durationMinutes = 240,
    } = body

    // Validation
    if (!candidateName || !challenge) {
      return NextResponse.json(
        {
          success: false,
          error: 'Candidate name and challenge are required',
        },
        { status: 400 }
      )
    }

    // Create take-home test
    const takehome = await takehomeManager.createTakehome({
      candidateName,
      challenge,
      customInstructions: customInstructions || '',
      availabilityWindowDays,
      durationMinutes,
    })

    // Generate URL
    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'
    const url = `${baseUrl}/take-home/${takehome.passcode}`

    return NextResponse.json({
      success: true,
      passcode: takehome.passcode,
      url,
      validUntil:
        typeof takehome.validUntil === 'string'
          ? takehome.validUntil
          : takehome.validUntil.toISOString(),
    })
  } catch (error) {
    console.error('Error creating take-home test:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create take-home test',
      },
      { status: 500 }
    )
  }
}

/**
 * Lists all active take-home tests.
 *
 * @returns JSON response with active take-home tests
 */
export async function GET() {
  try {
    const takehomes = await takehomeManager.getActiveTakehomes()

    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'

    const takehomesWithUrls = takehomes.map(t => ({
      passcode: t.passcode,
      candidateName: t.candidateName,
      challenge: t.challenge,
      customInstructions: t.customInstructions,
      status: t.status,
      validUntil:
        typeof t.validUntil === 'string'
          ? t.validUntil
          : t.validUntil.toISOString(),
      createdAt:
        typeof t.createdAt === 'string'
          ? t.createdAt
          : t.createdAt.toISOString(),
      activatedAt: t.activatedAt
        ? typeof t.activatedAt === 'string'
          ? t.activatedAt
          : t.activatedAt.toISOString()
        : undefined,
      durationMinutes: t.durationMinutes,
      url: `${baseUrl}/take-home/${t.passcode}`,
      interviewId: t.interviewId,
    }))

    return NextResponse.json({ takehomes: takehomesWithUrls })
  } catch (error) {
    console.error('Error listing take-home tests:', error)
    return NextResponse.json(
      {
        error: 'Failed to list take-home tests',
      },
      { status: 500 }
    )
  }
}
