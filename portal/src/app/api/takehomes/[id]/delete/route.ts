// portal/src/app/api/takehomes/[id]/delete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { assessmentManager } from '@/lib/assessments'
import { operationManager } from '@/lib/operations'
import { destroyInstance } from '@/lib/instance'
import { openaiService } from '@/lib/openai'
import { logger } from '@/lib/logger'

/**
 * DELETE endpoint for managers to delete take-home assessments.
 *
 * Behavior:
 * - For non-activated take-homes (available/expired): Delete immediately from DynamoDB
 * - For activated take-homes: Create destroy operation and trigger infrastructure cleanup
 * - Always clean up OpenAI service accounts if they exist
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params

    logger.info('Delete take-home request received', { id })

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
    })

    // Verify it's a take-home (not an interview)
    if (assessment.sessionType !== 'takehome') {
      return NextResponse.json(
        { error: 'This endpoint is for take-homes only, not a take-home' },
        { status: 400 }
      )
    }

    // Check if take-home has been activated (has infrastructure)
    const isActivated = assessment.sessionStatus === 'activated'

    if (isActivated) {
      // Take-home has infrastructure - trigger background destruction
      logger.info('Initiating destruction for activated take-home', {
        takeHomeId: id,
        candidateName: assessment.candidateName,
      })

      // Create operation to track progress
      const operationId = await operationManager.createOperation(
        'destroy',
        id,
        assessment.candidateName,
        assessment.challengeId
      )

      // Start background operation
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, 'running')
          await operationManager.addOperationLog(
            operationId,
            `Starting take-home destruction for ${id}`
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
            saveFiles: assessment.saveFiles,
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
              'Take-home destroyed successfully!'
            )

            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key,
            })
          } else {
            await operationManager.addOperationLog(
              operationId,
              'Take-home destruction failed'
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
        message: 'Destruction initiated',
      })
    } else {
      // Take-home has not been activated - delete directly from DynamoDB
      logger.info('Deleting non-activated take-home', {
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
          // Continue with deletion even if OpenAI cleanup fails
        }
      }

      // Delete from DynamoDB
      await assessmentManager.deleteTakeHome(id)

      return NextResponse.json({
        success: true,
        message: 'Take-home deleted successfully',
      })
    }
  } catch (error) {
    logger.error('Failed to delete take-home', { error })
    return NextResponse.json(
      {
        error: 'Failed to delete take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
