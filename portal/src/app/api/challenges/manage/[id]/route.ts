import { NextRequest, NextResponse } from 'next/server'
import {
  challengeService,
  ChallengeValidator,
  UpdateChallengeInput,
} from '@/lib/challenges'
import { logger } from '@/lib/logger'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/challenges/manage/[id]
 * Get a specific challenge by ID
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    logger.info(`[API] Getting challenge: ${id}`)

    const challenge = await challengeService.getChallenge(id)

    if (!challenge) {
      return NextResponse.json(
        {
          success: false,
          error: 'Challenge not found',
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      challenge,
    })
  } catch (error) {
    const { id: paramId } = await params
    logger.error(
      `[API] Error getting challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/challenges/manage/[id]
 * Update a specific challenge
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await request.json()
    logger.info(`[API] Updating challenge: ${id}`)

    // Validate ECS config if provided
    if (body.ecsConfig) {
      const configErrors = ChallengeValidator.validateECSConfig(body.ecsConfig)
      if (configErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'ECS configuration validation failed',
            validationErrors: configErrors,
          },
          { status: 400 }
        )
      }
    }

    // Validate other fields
    const errors: string[] = []
    if (
      body.name !== undefined &&
      (!body.name || body.name.trim().length === 0)
    ) {
      errors.push('Challenge name cannot be empty')
    }
    if (
      body.description !== undefined &&
      (!body.description || body.description.trim().length === 0)
    ) {
      errors.push('Challenge description cannot be empty')
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          validationErrors: errors,
        },
        { status: 400 }
      )
    }

    const updatedChallenge = await challengeService.updateChallenge(
      id,
      body as UpdateChallengeInput
    )

    logger.info(`[API] Challenge updated successfully: ${id}`)

    return NextResponse.json({
      success: true,
      challenge: updatedChallenge,
    })
  } catch (error) {
    const { id: paramId } = await params
    logger.error(
      `[API] Error updating challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Challenge not found or already deleted',
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/challenges/manage/[id]
 * Soft delete a challenge (mark as inactive)
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    logger.info(`[API] Deleting challenge: ${id}`)

    await challengeService.deleteChallenge(id)

    logger.info(`[API] Challenge deleted successfully: ${id}`)

    return NextResponse.json({
      success: true,
      message: 'Challenge deleted successfully',
    })
  } catch (error) {
    const { id: paramId } = await params
    logger.error(
      `[API] Error deleting challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Challenge not found or already deleted',
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
