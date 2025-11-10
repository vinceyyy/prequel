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

    // Generate unique 8-character passcode using takehomeManager
    const passcode = takehomeManager.generatePasscode()

    // Calculate valid until date
    const validUntil = new Date(
      Date.now() + availabilityWindowDays * 24 * 60 * 60 * 1000
    )

    // Create interview record in unified interviews table
    console.log('[DEBUG] Creating take-home interview:', {
      interviewId,
      passcode,
      candidateName,
      challenge,
      validUntil: validUntil.toISOString(),
      durationMinutes,
    })

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

    console.log('[DEBUG] Take-home interview created successfully:', {
      id: interview.id,
      passcode: interview.passcode,
      type: interview.type,
      status: interview.status,
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
    const statusFilter = searchParams.get('status') // 'active', 'history', or null (all)

    let takehomes: TakehomeTest[] = []

    if (statusFilter === 'history') {
      // Get historical (destroyed/completed) take-home tests from unified interviews table
      const historicalInterviews =
        await interviewManager.getHistoricalInterviews()
      takehomes = historicalInterviews
        .filter(interview => interview.type === 'take-home')
        .map(interview => ({
          id: interview.id,
          passcode: interview.passcode!,
          candidateName: interview.candidateName,
          challenge: interview.challenge,
          status: interview.status,
          validUntil: interview.validUntil!,
          durationMinutes: interview.durationMinutes,
          customInstructions: interview.customInstructions,
          createdAt: interview.createdAt,
          activatedAt: interview.activatedAt,
        }))
    } else if (statusFilter === 'active') {
      // Get active take-home tests (including error status) from unified interviews table
      const activeInterviews = await interviewManager.getActiveInterviews()
      takehomes = activeInterviews
        .filter(interview => interview.type === 'take-home')
        .map(interview => ({
          id: interview.id,
          passcode: interview.passcode!,
          candidateName: interview.candidateName,
          challenge: interview.challenge,
          status: interview.status,
          validUntil: interview.validUntil!,
          durationMinutes: interview.durationMinutes,
          customInstructions: interview.customInstructions,
          createdAt: interview.createdAt,
          activatedAt: interview.activatedAt,
        }))
    } else {
      // Get all take-home tests (active + historical)
      const [activeInterviews, historicalInterviews] = await Promise.all([
        interviewManager.getActiveInterviews(),
        interviewManager.getHistoricalInterviews(),
      ])

      const activeTakehomes = activeInterviews
        .filter(interview => interview.type === 'take-home')
        .map(interview => ({
          id: interview.id,
          passcode: interview.passcode!,
          candidateName: interview.candidateName,
          challenge: interview.challenge,
          status: interview.status,
          validUntil: interview.validUntil!,
          durationMinutes: interview.durationMinutes,
          customInstructions: interview.customInstructions,
          createdAt: interview.createdAt,
          activatedAt: interview.activatedAt,
        }))

      const historicalTakehomes = historicalInterviews
        .filter(interview => interview.type === 'take-home')
        .map(interview => ({
          id: interview.id,
          passcode: interview.passcode!,
          candidateName: interview.candidateName,
          challenge: interview.challenge,
          status: interview.status,
          validUntil: interview.validUntil!,
          durationMinutes: interview.durationMinutes,
          customInstructions: interview.customInstructions,
          createdAt: interview.createdAt,
          activatedAt: interview.activatedAt,
        }))

      takehomes = [...activeTakehomes, ...historicalTakehomes]
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
