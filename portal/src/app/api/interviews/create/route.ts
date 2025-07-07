import { NextRequest, NextResponse } from 'next/server'
import { terraformManager } from '@/lib/terraform'
import { operationManager } from '@/lib/operations'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { candidateName, challenge, scheduledAt, autoDestroyMinutes } = body

    if (!candidateName || !challenge) {
      return NextResponse.json(
        { error: 'candidateName and challenge are required' },
        { status: 400 }
      )
    }

    // Parse scheduled time if provided
    let scheduledDate: Date | undefined
    if (scheduledAt) {
      scheduledDate = new Date(scheduledAt)
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid scheduledAt date format' },
          { status: 400 }
        )
      }

      // Ensure scheduled time is in the future (comparing UTC times)
      const now = new Date()
      if (scheduledDate <= now) {
        return NextResponse.json(
          { 
            error: 'scheduledAt must be in the future',
            details: `Scheduled: ${scheduledDate.toISOString()}, Now: ${now.toISOString()}`
          },
          { status: 400 }
        )
      }
    }

    // Auto-destroy is required for all interviews
    if (
      !autoDestroyMinutes ||
      typeof autoDestroyMinutes !== 'number' ||
      autoDestroyMinutes <= 0
    ) {
      return NextResponse.json(
        {
          error: 'autoDestroyMinutes is required and must be a positive number',
        },
        { status: 400 }
      )
    }

    const baseTime = scheduledDate || new Date()
    const autoDestroyDate = new Date(
      baseTime.getTime() + autoDestroyMinutes * 60 * 1000
    )

    const interviewId = uuidv4().substring(0, 8)
    const password = Math.random().toString(36).substring(2, 12)

    // Create operation to track progress
    const operationId = operationManager.createOperation(
      'create',
      interviewId,
      candidateName,
      challenge,
      scheduledDate,
      autoDestroyDate
    )

    const instance = {
      id: interviewId,
      candidateName,
      challenge,
      password,
    }

    // If scheduled for later, don't start immediately
    if (scheduledDate) {
      operationManager.addOperationLog(
        operationId,
        `Interview scheduled for ${scheduledDate.toLocaleString()}`
      )
      if (autoDestroyDate) {
        operationManager.addOperationLog(
          operationId,
          `Auto-destroy scheduled for ${autoDestroyDate.toLocaleString()}`
        )
      }

      return NextResponse.json({
        operationId,
        interviewId,
        candidateName,
        challenge,
        password,
        scheduledAt: scheduledDate.toISOString(),
        autoDestroyAt: autoDestroyDate.toISOString(),
        message: `Interview scheduled for ${scheduledDate.toLocaleString()}`,
      })
    }

    // Start background operation immediately
    setImmediate(async () => {
      try {
        operationManager.updateOperationStatus(operationId, 'running')
        operationManager.addOperationLog(
          operationId,
          `Starting interview creation for ${candidateName}`
        )
        operationManager.addOperationLog(
          operationId,
          `Interview ID: ${interviewId}`
        )
        operationManager.addOperationLog(operationId, `Challenge: ${challenge}`)

        const result = await terraformManager.createInterviewStreaming(
          instance,
          (data: string) => {
            // Add each line to operation logs
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              operationManager.addOperationLog(operationId, line)
            })
          }
        )

        if (result.success) {
          operationManager.addOperationLog(
            operationId,
            '✅ Interview created successfully!'
          )
          operationManager.addOperationLog(
            operationId,
            `Access URL: ${result.accessUrl}`
          )

          operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: password,
            fullOutput: result.fullOutput,
          })
        } else {
          operationManager.addOperationLog(
            operationId,
            '❌ Interview creation failed'
          )
          operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          )

          operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            fullOutput: result.fullOutput,
          })
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error'
        operationManager.addOperationLog(operationId, `❌ Error: ${errorMsg}`)
        operationManager.setOperationResult(operationId, {
          success: false,
          error: errorMsg,
        })
      }
    })

    return NextResponse.json({
      operationId,
      interviewId,
      candidateName,
      challenge,
      password,
      autoDestroyAt: autoDestroyDate?.toISOString(),
      message: 'Interview creation started in background',
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to start interview creation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
