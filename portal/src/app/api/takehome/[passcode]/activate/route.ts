import { NextRequest, NextResponse } from 'next/server'
import { takehomeManager } from '@/lib/takehome'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'

// Rate limiting: Track activation attempts per IP
const activationAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 3
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

/**
 * Activates a take-home test and starts interview provisioning.
 *
 * Includes rate limiting: 3 attempts per IP per hour.
 *
 * @param request - NextRequest object
 * @param params - Route parameters with passcode
 * @returns JSON response with operation ID or error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode } = await params

    // Get client IP for rate limiting
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown'

    // Check rate limit
    const now = Date.now()
    const attempts = activationAttempts.get(ip)

    if (attempts) {
      if (now < attempts.resetAt) {
        if (attempts.count >= MAX_ATTEMPTS) {
          return NextResponse.json(
            {
              success: false,
              error:
                'Too many activation attempts. Please try again in 1 hour.',
            },
            { status: 429 }
          )
        }
        attempts.count++
      } else {
        // Reset window
        activationAttempts.set(ip, {
          count: 1,
          resetAt: now + RATE_LIMIT_WINDOW_MS,
        })
      }
    } else {
      activationAttempts.set(ip, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      })
    }

    // Get take-home test
    const takehome = await takehomeManager.getTakehome(passcode)
    if (!takehome) {
      return NextResponse.json(
        { success: false, error: 'Take-home test not found' },
        { status: 404 }
      )
    }

    // Validate status
    if (takehome.status !== 'active') {
      return NextResponse.json(
        {
          success: false,
          error:
            takehome.status === 'activated'
              ? 'This take-home test has already been started'
              : takehome.status === 'completed'
                ? 'This take-home test has been completed'
                : 'This take-home test is no longer available',
        },
        { status: 400 }
      )
    }

    // Validate expiry
    if (new Date() > takehome.validUntil) {
      return NextResponse.json(
        {
          success: false,
          error: 'This take-home test invitation has expired',
        },
        { status: 400 }
      )
    }

    // Generate interview ID and password
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 7)
    const interviewId = `takehome-${timestamp}-${random}`
    const password = Math.random().toString(36).substring(2, 12)

    // Calculate auto-destroy time
    const autoDestroyDate = new Date(
      Date.now() + takehome.durationMinutes * 60 * 1000
    )

    // Create operation for interview creation
    const operationId = await operationManager.createOperation(
      'create',
      interviewId,
      takehome.candidateName,
      takehome.challenge,
      undefined, // No scheduled time
      autoDestroyDate,
      true // Always save files for take-home tests
    )

    // Mark as activated
    await takehomeManager.activateTakehome(passcode, interviewId)

    const instance = {
      id: interviewId,
      candidateName: takehome.candidateName,
      challenge: takehome.challenge,
      password,
    }

    // Start background provisioning with auto-destroy
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Starting take-home interview for ${takehome.candidateName}`
        )
        await operationManager.addOperationLog(
          operationId,
          `Interview ID: ${interviewId}`
        )
        await operationManager.addOperationLog(
          operationId,
          `Challenge: ${takehome.challenge}`
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
            // Infrastructure is ready - update operation to show configuring status
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
          true // Always save files for take-home tests
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Take-home interview created successfully!'
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
            '❌ Take-home interview creation failed'
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
      interviewId,
    })
  } catch (error) {
    console.error('Error activating take-home test:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
