import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager, TakehomeTest } from '@/lib/takehome'
import { interviewManager } from '@/lib/interviews'
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

    // Generate unique interview ID with takehome prefix
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 7)
    const interviewId = `takehome-${timestamp}-${random}`

    // Generate unique 8-character passcode
    const passcode = Math.random().toString(36).substring(2, 10).toUpperCase()

    // Calculate valid until date
    const validUntil = new Date(
      Date.now() + availabilityWindowDays * 24 * 60 * 60 * 1000
    )

    // Create interview record in unified interviews table
    const interview = await interviewManager.createInterview({
      id: interviewId,
      type: 'take-home',
      candidateName,
      challenge,
      status: 'active', // Invitation is active (not yet started by candidate)
      passcode,
      validUntil,
      customInstructions: customInstructions || '',
      durationMinutes,
      // autoDestroyAt will be set when candidate activates the test
    })

    // Generate URL
    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'
    const url = `${baseUrl}/take-home/${interview.passcode}`

    return NextResponse.json({
      success: true,
      passcode: interview.passcode,
      url,
      validUntil: interview.validUntil?.toISOString(),
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
 * Lists take-home tests with optional status filtering.
 *
 * @param request - NextRequest with optional status query parameter
 * @returns JSON response with take-home tests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // 'active', 'history', or null (all)

    let takehomes: TakehomeTest[] = []

    if (status === 'history') {
      // Get historical (completed/revoked) take-home tests
      takehomes = await takehomeManager.getHistoricalTakehomes()
    } else if (status === 'active') {
      // Get only active take-home tests
      takehomes = await takehomeManager.getActiveTakehomes()
    } else {
      // Get all take-home tests (active + historical)
      const [active, historical] = await Promise.all([
        takehomeManager.getActiveTakehomes(),
        takehomeManager.getHistoricalTakehomes(),
      ])
      takehomes = [...active, ...historical]
    }

    // Generate URLs for active tests
    const domainName = config.project.domainName
    const baseUrl = domainName
      ? `https://${domainName}`
      : 'http://localhost:3000'

    const takehomesWithUrls = takehomes.map(takehome => ({
      ...takehome,
      validUntil:
        typeof takehome.validUntil === 'string'
          ? takehome.validUntil
          : takehome.validUntil.toISOString(),
      createdAt:
        typeof takehome.createdAt === 'string'
          ? takehome.createdAt
          : takehome.createdAt.toISOString(),
      activatedAt: takehome.activatedAt
        ? typeof takehome.activatedAt === 'string'
          ? takehome.activatedAt
          : takehome.activatedAt.toISOString()
        : undefined,
      url:
        takehome.status === 'active'
          ? `${baseUrl}/take-home/${takehome.passcode}`
          : undefined,
    }))

    return NextResponse.json({ takehomes: takehomesWithUrls })
  } catch (error: unknown) {
    console.error('Error listing take-home tests:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch take-home tests',
        details:
          process.env.NODE_ENV === 'development' && error instanceof Error
            ? error.message
            : undefined,
      },
      { status: 500 }
    )
  }
}
