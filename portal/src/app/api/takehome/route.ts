import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager, TakehomeTest } from '@/lib/takehome'
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
