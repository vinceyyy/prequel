import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * Revokes a take-home test and destroys running interview if activated.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response indicating success/failure
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    // Get take-home test
    const takehome = await takehomeManager.getTakehome(passcode)
    if (!takehome) {
      return NextResponse.json(
        { success: false, error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    let operationId: string | undefined

    // If activated, destroy the interview
    if (takehome.status === 'activated' && takehome.interviewId) {
      // Cancel any scheduled operations for this interview
      const cancelledCount =
        await operationManager.cancelScheduledOperationsForInterview(
          takehome.interviewId
        )
      if (cancelledCount > 0) {
        console.log(
          `Cancelled ${cancelledCount} scheduled operations for take-home interview ${takehome.interviewId}`
        )
      }

      // Create operation to track progress
      operationId = await operationManager.createOperation(
        'destroy',
        takehome.interviewId,
        takehome.candidateName,
        takehome.challenge
      )

      // Start background destruction
      setImmediate(async () => {
        try {
          await operationManager.updateOperationStatus(operationId!, 'running')
          await operationManager.addOperationLog(
            operationId!,
            `Destroying take-home interview for ${takehome.candidateName}`
          )

          if (cancelledCount > 0) {
            await operationManager.addOperationLog(
              operationId!,
              `Cancelled ${cancelledCount} scheduled operation(s) for this interview`
            )
          }

          const result =
            await interviewManager.destroyInterviewWithInfrastructure(
              takehome.interviewId!,
              (data: string) => {
                // Add each line to operation logs
                const lines = data.split('\n').filter(line => line.trim())
                lines.forEach(line => {
                  operationManager
                    .addOperationLog(operationId!, line)
                    .catch(console.error)
                })
              },
              takehome.candidateName,
              takehome.challenge,
              true // Always save files for take-home tests
            )

          if (result.success) {
            await operationManager.addOperationLog(
              operationId!,
              '✅ Take-home interview destroyed successfully!'
            )

            await operationManager.setOperationResult(operationId!, {
              success: true,
              fullOutput: result.fullOutput,
              historyS3Key: result.historyS3Key,
            })
          } else {
            await operationManager.addOperationLog(
              operationId!,
              '❌ Take-home interview destruction failed'
            )
            await operationManager.addOperationLog(
              operationId!,
              `Error: ${result.error}`
            )

            await operationManager.setOperationResult(operationId!, {
              success: false,
              error: result.error,
              fullOutput: result.fullOutput,
            })
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : 'Unknown error'
          await operationManager.addOperationLog(
            operationId!,
            `❌ Error: ${errorMsg}`
          )
          await operationManager.setOperationResult(operationId!, {
            success: false,
            error: errorMsg,
          })
        }
      })
    }

    // Revoke the take-home test
    const revoked = await takehomeManager.revokeTakehome(passcode)

    if (revoked) {
      return NextResponse.json({
        success: true,
        message: 'Take-home test revoked successfully',
        operationId, // Include operation ID if interview is being destroyed
      })
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to revoke take-home test' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error revoking take-home test:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
