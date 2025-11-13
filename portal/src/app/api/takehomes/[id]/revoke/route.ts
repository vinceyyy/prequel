// portal/src/app/api/takehomes/[id]/revoke/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { assessmentManager } from '@/lib/assessments'
import { operationManager } from '@/lib/operations'
import { destroyInstance } from '@/lib/instance'
import { openaiService } from '@/lib/openai'
import { logger } from '@/lib/logger'

/**
 * POST endpoint for managers to revoke take-home assessments.
 *
 * Behavior:
 * - For non-activated take-homes (available): Update sessionStatus to 'revoked' immediately
 * - For activated take-homes: Create destroy operation, trigger infrastructure cleanup, and set sessionStatus to 'revoked'
 * - Always clean up OpenAI service accounts if they exist
 * - Always save files (saveFiles: true) for revoked take-homes
 * - Prevents revocation if take-home is already in destroying state
 * - Prevents duplicate revoke operations
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params

    logger.info('Revoke take-home request received', { id })

    // Get take-home record
    const assessment = await assessmentManager.getAssessment(id)

    if (!assessment) {
      logger.warn('Take-home not found in database', { id })
      return NextResponse.json(
        { error: 'Take-home not found' },
        { status: 404 }
      )
    }

    logger.info('Take-home found', {
      id,
      sessionType: assessment.sessionType,
      sessionStatus: assessment.sessionStatus,
      instanceStatus: assessment.instanceStatus,
    })

    // Verify it's a take-home (not an interview)
    if (assessment.sessionType !== 'takehome') {
      return NextResponse.json(
        { error: 'This endpoint is for take-homes only' },
        { status: 400 }
      )
    }

    // Check if already in a terminal state
    if (
      assessment.sessionStatus === 'completed' ||
      assessment.sessionStatus === 'expired' ||
      assessment.sessionStatus === 'revoked'
    ) {
      return NextResponse.json(
        {
          error: `Cannot revoke - take-home is already ${assessment.sessionStatus}`,
        },
        { status: 400 }
      )
    }

    // Check if currently destroying
    if (assessment.instanceStatus === 'destroying') {
      return NextResponse.json(
        { error: 'Cannot revoke - already destroying' },
        { status: 400 }
      )
    }

    // Check for existing revoke operations to prevent duplicates
    const existingOperations =
      await operationManager.getOperationsByInterview(id)
    const hasActiveRevoke = existingOperations.some(
      op =>
        op.type === 'revoke_takehome' &&
        (op.status === 'pending' || op.status === 'running')
    )

    if (hasActiveRevoke) {
      return NextResponse.json(
        { error: 'Revocation already in progress' },
        { status: 400 }
      )
    }

    // Check if take-home has been activated (has infrastructure)
    const isActivated = assessment.sessionStatus === 'activated'

    if (isActivated) {
      // Take-home has infrastructure - trigger background destruction
      logger.info('Initiating destruction for activated take-home (revoke)', {
        takeHomeId: id,
        candidateName: assessment.candidateName,
      })

      // Create operation to track progress
      const operationId = await operationManager.createOperation(
        'revoke_takehome',
        id,
        assessment.candidateName,
        assessment.challengeId,
        undefined, // scheduledAt
        undefined, // autoDestroyAt
        true // saveFiles - always save files for revoked take-homes
      )

      // Start background operation
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, 'running')
          await operationManager.addOperationLog(
            operationId,
            `Starting take-home revocation for ${id}`
          )

          // Update session status to 'revoked' and instance status to 'destroying'
          await assessmentManager.updateSessionStatus(id, 'takehome', 'revoked')
          await assessmentManager.updateInstanceStatus(
            id,
            'takehome',
            'destroying'
          )
          await operationManager.addOperationLog(
            operationId,
            'Take-home status set to revoked, destroying infrastructure'
          )

          // Delete OpenAI service account if exists
          if (assessment.openaiServiceAccount) {
            await operationManager.addOperationLog(
              operationId,
              'Deleting OpenAI service account...'
            )

            const deleteResult = await openaiService.deleteServiceAccount(
              assessment.openaiServiceAccount.projectId,
              assessment.openaiServiceAccount.serviceAccountId
            )

            if (deleteResult.success) {
              await operationManager.addOperationLog(
                operationId,
                'OpenAI service account deleted successfully'
              )
            } else {
              await operationManager.addOperationLog(
                operationId,
                `OpenAI service account deletion failed: ${deleteResult.error}`
              )
            }
          }

          // Destroy infrastructure
          const result = await destroyInstance(id, {
            saveFiles: true, // Always save files for revoked take-homes
            candidateName: assessment.candidateName,
            challenge: assessment.challengeId,
            onData: (data: string) => {
              const lines = data.split('\n').filter(line => line.trim())
              lines.forEach(line => {
                operationManager
                  .addOperationLog(operationId, line)
                  .catch(console.error)
              })
            },
          })

          if (result.success) {
            await operationManager.addOperationLog(
              operationId,
              'Infrastructure destroyed successfully'
            )

            await operationManager.addOperationLog(
              operationId,
              'Take-home revoked successfully!'
            )

            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key,
            })
          } else {
            await operationManager.addOperationLog(
              operationId,
              'Take-home revocation failed'
            )
            await operationManager.addOperationLog(
              operationId,
              `Error: ${result.error}`
            )

            await operationManager.setOperationResult(operationId, {
              success: false,
              error: result.error,
              fullOutput: result.fullOutput,
            })
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error'
          await operationManager.addOperationLog(
            operationId,
            `Error: ${errorMsg}`
          )
          await operationManager.setOperationResult(operationId, {
            success: false,
            error: errorMsg,
          })
        }
      })

      return NextResponse.json({
        success: true,
        operationId,
        message: 'Revocation initiated',
      })
    } else {
      // Take-home has not been activated - update status directly
      logger.info('Revoking non-activated take-home', {
        takeHomeId: id,
        sessionStatus: assessment.sessionStatus,
      })

      // Delete OpenAI service account if exists
      if (assessment.openaiServiceAccount) {
        try {
          await openaiService.deleteServiceAccount(
            assessment.openaiServiceAccount.projectId,
            assessment.openaiServiceAccount.serviceAccountId
          )
          logger.info('OpenAI service account deleted', { takeHomeId: id })
        } catch (error) {
          logger.warn('Failed to delete OpenAI service account', {
            takeHomeId: id,
            error,
          })
          // Continue with revocation even if OpenAI cleanup fails
        }
      }

      // Update session status to 'revoked'
      await assessmentManager.updateSessionStatus(id, 'takehome', 'revoked')

      return NextResponse.json({
        success: true,
        message: 'Take-home revoked successfully',
      })
    }
  } catch (error) {
    logger.error('Failed to revoke take-home', { error })
    return NextResponse.json(
      {
        error: 'Failed to revoke take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
