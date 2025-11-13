// portal/src/app/api/takehome/[token]/activate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { assessmentManager } from '@/lib/assessments'
import { operationManager } from '@/lib/operations'
import { provisionInstance } from '@/lib/instance'
import { logger } from '@/lib/logger'
import { generateSecureString } from '@/lib/idGenerator'

/**
 * POST /api/takehome/[token]/activate
 *
 * Activates a take-home assessment for a candidate.
 * Validates availability window, creates provisioning operation,
 * and starts background instance provisioning.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params

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
    const durationHours = takeHome.durationHours || 4 // Use stored duration, fallback to 4
    const autoDestroyAt = new Date(Date.now() + durationHours * 60 * 60 * 1000)
    const activatedAt = Math.floor(Date.now() / 1000)

    // Generate secure random password for VS Code instance
    const password = generateSecureString()

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

    // Update take-home: sessionStatus='activated', isActivated=true, activatedAt=now, autoDestroyAt
    await assessmentManager.updateSessionStatus(
      takeHome.id,
      'takehome',
      'activated'
    )
    await assessmentManager.updateTakeHomeActivation(
      takeHome.id,
      activatedAt,
      Math.floor(autoDestroyAt.getTime() / 1000)
    )

    // Start background provisioning using instance.provisionInstance()
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')

        const result = await provisionInstance({
          instanceId: takeHome.id,
          candidateName: takeHome.candidateName || 'Candidate',
          challengeId: takeHome.challengeId,
          password, // Securely generated random password
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
              password
            )
          },
        })

        logger.info('Provisioning completed', {
          takeHomeId: takeHome.id,
          operationId,
          success: result.success,
          hasAccessUrl: !!result.accessUrl,
          error: result.error,
        })

        await operationManager.addOperationLog(
          operationId,
          `Provisioning result: success=${result.success}, accessUrl=${result.accessUrl || 'none'}`
        )

        await operationManager.setOperationResult(operationId, result)

        if (result.success) {
          logger.info('Updating instance status to active', {
            takeHomeId: takeHome.id,
          })
          await assessmentManager.updateInstanceStatus(
            takeHome.id,
            'takehome',
            'active'
          )

          // Update access credentials if available
          if (result.accessUrl) {
            await assessmentManager.updateAccessCredentials(
              takeHome.id,
              result.accessUrl,
              password
            )
            await operationManager.addOperationLog(
              operationId,
              `✅ Access credentials updated: ${result.accessUrl}`
            )
          }

          await operationManager.addOperationLog(
            operationId,
            '✅ Instance status updated to active'
          )
        } else {
          logger.error('Provisioning failed, updating status to error', {
            takeHomeId: takeHome.id,
            error: result.error,
          })
          await assessmentManager.updateInstanceStatus(
            takeHome.id,
            'takehome',
            'error'
          )
          await operationManager.addOperationLog(
            operationId,
            `❌ Provisioning failed: ${result.error}`
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
