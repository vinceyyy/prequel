import { NextRequest, NextResponse } from 'next/server'
import {
  challengeService,
  ChallengeValidator,
  CreateChallengeInput,
} from '@/lib/challenges'
import { logger } from '@/lib/logger'

/**
 * GET /api/challenges/manage
 * List all challenges for management interface
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sortBy =
      (searchParams.get('sortBy') as 'newest' | 'usage' | 'lastUsed') ||
      'newest'

    logger.info(`[API] Listing challenges for management (sortBy: ${sortBy})`)

    const challenges = await challengeService.listChallenges(sortBy)

    return NextResponse.json({
      success: true,
      challenges,
      count: challenges.length,
    })
  } catch (error) {
    logger.error(
      `[API] Error listing challenges for management: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to list challenges',
        challenges: [],
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/challenges/manage
 * Create a new challenge
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    logger.info('[API] Creating new challenge:', { name: body.name })

    // Validate input
    const validationErrors = ChallengeValidator.validateCreateInput(body)
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          validationErrors,
        },
        { status: 400 }
      )
    }

    const challenge = await challengeService.createChallenge(
      body as CreateChallengeInput
    )

    logger.info(`[API] Challenge created successfully: ${challenge.id}`)

    return NextResponse.json(
      {
        success: true,
        challenge,
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error(
      `[API] Error creating challenge: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Challenge already exists',
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
