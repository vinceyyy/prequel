import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * Revokes a take-home test invitation or destroys the running instance.
 *
 * For running instances, this creates a destroy operation and shows progress.
 * For invitations (not yet activated), this immediately marks as destroyed.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response indicating success or error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    // Get the interview by passcode
    const interview = await interviewManager.getInterviewByPasscode(passcode)

    if (!interview || interview.type !== 'take-home') {
      return NextResponse.json(
        { error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    // If interview is running (activated), destroy it with background operation
    if (
      interview.status === 'activated' ||
      interview.status === 'initializing' ||
      interview.status === 'configuring' ||
      interview.status === 'active'
    ) {
      // Cancel any scheduled operations for this interview
      const cancelledCount =
        await operationManager.cancelScheduledOperationsForInterview(
          interview.id
        )
      if (cancelledCount > 0) {
        console.log(
          `Cancelled ${cancelledCount} scheduled operations for interview ${interview.id}`
        )
      }

      // Create destroy operation to track progress
      const operationId = await operationManager.createOperation(
        'destroy',
        interview.id,
        interview.candidateName,
        interview.challenge
      )

      // Start background destruction with progress tracking
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId, 'running')
          await operationManager.addOperationLog(
            operationId,
            `Revoking take-home test for ${interview.candidateName}`
          )
          await operationManager.addOperationLog(
            operationId,
            `Interview ID: ${interview.id}`
          )

          if (cancelledCount > 0) {
            await operationManager.addOperationLog(
              operationId,
              `Cancelled ${cancelledCount} scheduled operation(s)`
            )
          }

          const result =
            await interviewManager.destroyInterviewWithInfrastructure(
              interview.id,
              (data: string) => {
                // Add each line to operation logs
                const lines = data.split('\n').filter(line => line.trim())
                lines.forEach(line => {
                  operationManager
                    .addOperationLog(operationId, line)
                    .catch(console.error)
                })
              },
              interview.candidateName,
              interview.challenge,
              true // Always save files for take-home tests
            )

          if (result.success) {
            await operationManager.addOperationLog(
              operationId,
              '✅ Take-home test revoked and instance destroyed successfully!'
            )

            await operationManager.setOperationResult(operationId, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key,
            })
          } else {
            await operationManager.addOperationLog(
              operationId,
              '❌ Take-home test destruction failed'
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
            `❌ Error: ${errorMsg}`
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
        interviewId: interview.id,
        message: 'Take-home test revocation started in background',
      })
    }

    // If interview is just an invitation (status='active', not yet activated), mark as destroyed
    // No infrastructure to destroy, just mark the invitation as revoked
    await interviewManager.updateInterviewStatus(interview.id, 'destroyed', {
      destroyedAt: new Date(),
    })

    return NextResponse.json({
      success: true,
      message: 'Take-home test invitation has been revoked',
    })
  } catch (error) {
    console.error('Error revoking take-home test:', error)
    return NextResponse.json(
      { error: 'Failed to revoke take-home test' },
      { status: 500 }
    )
  }
}
