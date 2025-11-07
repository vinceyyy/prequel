import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * POST /api/interviews/[id]/activate
 *
 * Activates a take-home test and starts infrastructure provisioning.
 * Called when candidate clicks "Start Test" button.
 *
 * Updates interview status to "activated" and creates operation.
 *
 * @param request - NextRequest object
 * @param params - Route parameters containing interview ID
 * @returns JSON response with operation ID or error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get the interview
    const interview = await interviewManager.getInterview(id)

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      )
    }

    // Validate it's a take-home test
    if (interview.type !== 'take-home') {
      return NextResponse.json(
        { error: 'Not a take-home test' },
        { status: 400 }
      )
    }

    // Validate it's in active status (not yet started)
    if (interview.status !== 'active') {
      return NextResponse.json(
        {
          error:
            interview.status === 'activated' ||
            interview.status === 'initializing' ||
            interview.status === 'configuring'
              ? 'Test has already been started'
              : interview.status === 'destroyed' ||
                  interview.status === 'destroying'
                ? 'Test has already been completed'
                : 'Test is not available',
        },
        { status: 400 }
      )
    }

    // Validate expiry
    if (interview.validUntil && new Date() > interview.validUntil) {
      return NextResponse.json(
        { error: 'Test invitation has expired' },
        { status: 400 }
      )
    }

    // Update interview to activated status
    await interviewManager.updateInterviewStatus(id, 'activated', {
      activatedAt: new Date(),
    })

    // Calculate auto-destroy time based on duration
    const autoDestroyDate = interview.durationMinutes
      ? new Date(Date.now() + interview.durationMinutes * 60 * 1000)
      : new Date(Date.now() + 4 * 60 * 60 * 1000) // Default 4 hours

    // Create operation for provisioning
    const operationId = await operationManager.createOperation(
      'create',
      id,
      interview.candidateName,
      interview.challenge,
      undefined, // No scheduled time (immediate)
      autoDestroyDate,
      true // Always save files for take-home tests
    )

    // Generate password
    const password = Math.random().toString(36).substring(2, 12)

    const instance = {
      id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      password,
    }

    // Start background provisioning
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Starting take-home test for ${interview.candidateName}`
        )
        await operationManager.addOperationLog(
          operationId,
          `Challenge: ${interview.challenge}`
        )
        await operationManager.addOperationLog(
          operationId,
          `Duration: ${interview.durationMinutes || 240} minutes`
        )

        const result = await interviewManager.createInterviewWithInfrastructure(
          instance,
          (data: string) => {
            // Add each line to operation logs
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              operationManager
                .addOperationLog(operationId, line)
                .catch(console.error)
            })
          },
          (accessUrl: string) => {
            // Infrastructure is ready - update operation
            operationManager
              .updateOperationInfrastructureReady(
                operationId,
                accessUrl,
                password
              )
              .catch(console.error)
            operationManager
              .addOperationLog(
                operationId,
                '🔧 Infrastructure ready, ECS service starting up...'
              )
              .catch(console.error)
          },
          undefined, // No scheduled time
          autoDestroyDate,
          true // Save files
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Take-home test ready!'
          )
          await operationManager.addOperationLog(
            operationId,
            `Access URL: ${result.accessUrl}`
          )

          await operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: password,
            fullOutput: result.fullOutput,
            healthCheckPassed: result.healthCheckPassed,
            infrastructureReady: result.infrastructureReady,
          })
        } else {
          await operationManager.addOperationLog(
            operationId,
            '❌ Provisioning failed'
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
      interviewId: id,
    })
  } catch (error) {
    console.error('Error activating interview:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
