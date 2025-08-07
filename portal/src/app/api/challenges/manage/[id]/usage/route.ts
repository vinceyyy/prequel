import { NextRequest, NextResponse } from 'next/server'
import { challengeService } from '@/lib/challenges'
import { logger } from '@/lib/logger'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/challenges/manage/[id]/usage
 * Increment usage count for a challenge (called when used in interview creation)
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    logger.info(`[API] Incrementing usage for challenge: ${id}`)

    await challengeService.incrementUsage(id)

    logger.info(`[API] Challenge usage incremented successfully: ${id}`)

    return NextResponse.json({
      success: true,
      message: 'Challenge usage incremented',
    })
  } catch (error) {
    const { id: paramId } = await params
    logger.error(
      `[API] Error incrementing usage for challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Challenge not found or inactive',
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to increment challenge usage',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
