import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

/**
 * Revokes a take-home test invitation or destroys the running instance.
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

    // If interview is running, destroy it
    if (
      interview.status === 'active' ||
      interview.status === 'initializing' ||
      interview.status === 'configuring'
    ) {
      // Cancel any pending operations for this interview
      const operations = await operationManager.getOperationsByInterview(
        interview.id
      )
      const pendingOps = operations.filter(
        op =>
          op.status === 'pending' ||
          op.status === 'scheduled' ||
          op.status === 'running'
      )

      for (const op of pendingOps) {
        await operationManager.cancelOperation(op.id)
      }

      // Update interview status to destroyed
      await interviewManager.updateInterviewStatus(interview.id, 'destroyed', {
        destroyedAt: new Date(),
      })

      return NextResponse.json({
        success: true,
        message: 'Take-home test has been revoked and instance destroyed',
      })
    }

    // If interview is just an invitation (not started), mark as destroyed
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
