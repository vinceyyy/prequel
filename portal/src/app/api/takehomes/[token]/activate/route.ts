// portal/src/app/api/takehomes/[token]/activate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { assessmentManager } from '@/lib/assessments'
import { operationManager } from '@/lib/operations'
import { provisionInstance } from '@/lib/instance'
import { logger } from '@/lib/logger'

/**
 * POST /api/takehomes/[token]/activate
 *
 * Activates a take-home assessment for a candidate.
 * Validates availability window, creates provisioning operation,
 * and starts background instance provisioning.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  try {
    const { token } = params

    // Look up take-home by access token
    const takeHome = await assessmentManager.getTakeHomeByToken(token)

    if (!takeHome) {
      return NextResponse.json(
        { error: 'Take-home not found' },
        { status: 404 }
      )
    }

    // Validate: sessionStatus is 'available'
    if (takeHome.sessionStatus !== 'available') {
      return NextResponse.json(
        { error: 'Take-home already activated or completed' },
        { status: 400 }
      )
    }

    // Validate: current time is within availableFrom/availableUntil window
    const now = Math.floor(Date.now() / 1000)
    if (now < takeHome.availableFrom || now > takeHome.availableUntil) {
      return NextResponse.json(
        { error: 'Take-home has expired or is not yet available' },
        { status: 400 }
      )
    }

    // Calculate autoDestroyAt based on durationHours (default 4 hours)
    const durationHours = 4 // Default to 4 hours
    const autoDestroyAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)

    // Create operation for provisioning
    const operationId = await operationManager.createOperation(
      'create',
      takeHome.id,
      takeHome.candidateName,
      takeHome.challengeId,
      undefined, // scheduledAt (immediate activation)
      autoDestroyAt,
      false // saveFiles
    )

    // Update take-home: sessionStatus='activated', isActivated=true, activatedAt=now
    await assessmentManager.updateSessionStatus(
      takeHome.id,
      'takehome',
      'activated'
    )

    // Start background provisioning using instance.provisionInstance()
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')

        const result = await provisionInstance({
          instanceId: takeHome.id,
          candidateName: takeHome.candidateName || 'Candidate',
          challengeId: takeHome.challengeId,
          password: takeHome.password || 'password', // Will be generated if not set
          autoDestroyAt: Math.floor(autoDestroyAt.getTime() / 1000),
          resourceConfig: takeHome.resourceConfig,
          openaiApiKey: takeHome.openaiServiceAccount?.apiKey,
          onData: (data: string) => {
            operationManager.addOperationLog(operationId, data)
          },
          onInfrastructureReady: (accessUrl: string) => {
            operationManager.updateOperationInfrastructureReady(
              operationId,
              accessUrl,
              takeHome.password
            )
          },
        })

        await operationManager.setOperationResult(operationId, result)

        if (result.success) {
          await assessmentManager.updateInstanceStatus(
            takeHome.id,
            'takehome',
            'active'
          )
        } else {
          await assessmentManager.updateInstanceStatus(
            takeHome.id,
            'takehome',
            'error'
          )
        }
      } catch (error) {
        logger.error('Take-home activation failed', {
          takeHomeId: takeHome.id,
          operationId,
          error,
        })
        await operationManager.setOperationResult(operationId, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        await assessmentManager.updateInstanceStatus(
          takeHome.id,
          'takehome',
          'error'
        )
      }
    })

    logger.info('Take-home activation started', {
      takeHomeId: takeHome.id,
      operationId,
      autoDestroyAt: autoDestroyAt.toISOString(),
    })

    return NextResponse.json({
      success: true,
      operationId,
      message: 'Take-home activation in progress',
      autoDestroyAt: autoDestroyAt.toISOString(),
    })
  } catch (error) {
    logger.error('Failed to activate take-home', { error })
    return NextResponse.json(
      {
        error: 'Failed to activate take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
