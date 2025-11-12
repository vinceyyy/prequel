import { NextRequest, NextResponse } from 'next/server'
import { interviewManager } from '@/lib/interviews'
import { operationManager } from '@/lib/operations'
import { challengeService } from '@/lib/challenges'
import { config } from '@/lib/config'
import { openaiService } from '@/lib/openai'
import { generateId, generateSecureString } from '@/lib/idGenerator'

/**
 * Creates a new coding interview instance.
 *
 * This endpoint provisions AWS infrastructure (ECS, ALB, Route53) for a secure,
 * isolated VS Code environment. Supports both immediate and scheduled creation
 * with mandatory auto-destroy to prevent resource waste.
 *
 * The creation process has distinct phases:
 * 1. **Initializing**: Terraform provisioning AWS resources
 * 2. **Configuring**: ECS container booting and installing dependencies
 * 3. **Active**: Service healthy and ready for candidate access
 *
 * @param request - NextRequest with interview configuration in JSON body
 * @returns JSON response with operation ID and interview details
 *
 * Request Body:
 * ```typescript
 * {
 *   candidateName: string;        // Required: Candidate name
 *   challenge: string;            // Required: Challenge name from S3
 *   autoDestroyMinutes: number;   // Required: Auto-destroy timeout (30-240)
 *   scheduledAt?: string;         // Optional: ISO date for scheduled creation
 *   saveFiles?: boolean;          // Optional: Save candidate files before destruction (default: true)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Create immediate interview
 * const response = await fetch('/api/interviews/create', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     candidateName: 'John Doe',
 *     challenge: 'javascript',
 *     autoDestroyMinutes: 60
 *   })
 * })
 *
 * // Schedule interview for later
 * const response = await fetch('/api/interviews/create', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     candidateName: 'Jane Smith',
 *     challenge: 'python',
 *     autoDestroyMinutes: 90,
 *     scheduledAt: '2025-01-15T10:00:00.000Z'
 *   })
 * })
 * ```
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      candidateName,
      challenge,
      scheduledAt,
      autoDestroyMinutes,
      saveFiles = true,
    } = body

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
            details: `Scheduled: ${scheduledDate.toISOString()}, Now: ${now.toISOString()}`,
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

    const interviewId = generateId()
    const password = generateSecureString()

    // Create operation to track progress
    const operationId = await operationManager.createOperation(
      'create',
      interviewId,
      candidateName,
      challenge,
      scheduledDate,
      autoDestroyDate,
      saveFiles
    )

    // Track challenge usage - increment usage count when interview is created
    try {
      // First, try to find the challenge by its ID
      const challenges = await challengeService.listChallenges('newest')
      const challengeRecord = challenges.find(c => c.id === challenge)

      if (challengeRecord) {
        await challengeService.incrementUsage(challengeRecord.id)
        await operationManager.addOperationLog(
          operationId,
          `📊 Challenge usage tracked: ${challengeRecord.name}`
        )
      } else {
        await operationManager.addOperationLog(
          operationId,
          `⚠️ Challenge not found in registry: ${challenge}`
        )
      }
    } catch (error) {
      // Don't fail the interview creation if challenge tracking fails
      console.warn('Failed to track challenge usage:', error)
      await operationManager.addOperationLog(
        operationId,
        `⚠️ Could not track challenge usage: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }

    // If scheduled for later, don't start immediately
    if (scheduledDate) {
      await operationManager.addOperationLog(
        operationId,
        `Interview scheduled for ${scheduledDate.toLocaleString()}`
      )
      if (autoDestroyDate) {
        await operationManager.addOperationLog(
          operationId,
          `Auto-destroy scheduled for ${autoDestroyDate.toLocaleString()}`
        )
      }

      // Construct access URL using domain from config
      const domainName = config.project.domainName
      const accessUrl = domainName
        ? `https://${interviewId}.${domainName}/`
        : `http://localhost:8443/` // Fallback for local development

      // Store credentials in operation result without changing status
      await operationManager.updateScheduledInterviewCredentials(
        operationId,
        accessUrl,
        password
      )

      return NextResponse.json({
        operationId,
        interviewId,
        candidateName,
        challenge,
        password,
        accessUrl,
        scheduledAt: scheduledDate.toISOString(),
        autoDestroyAt: autoDestroyDate.toISOString(),
        message: `Interview scheduled for ${scheduledDate.toLocaleString()}`,
      })
    }

    // Start background operation immediately
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Starting interview creation for ${candidateName}`
        )
        await operationManager.addOperationLog(
          operationId,
          `Interview ID: ${interviewId}`
        )
        await operationManager.addOperationLog(
          operationId,
          `Challenge: ${challenge}`
        )

        // Create OpenAI service account if configured
        let serviceAccountId: string | undefined
        let openaiApiKey: string | undefined

        if (config.services.openaiProjectId && config.services.openaiAdminKey) {
          await operationManager.addOperationLog(
            operationId,
            '🤖 Creating OpenAI service account...'
          )

          const serviceAccountResult = await openaiService.createServiceAccount(
            config.services.openaiProjectId,
            `interview-${interviewId}`
          )

          if (serviceAccountResult.success) {
            serviceAccountId = serviceAccountResult.serviceAccountId
            openaiApiKey = serviceAccountResult.apiKey
            await operationManager.addOperationLog(
              operationId,
              `✅ OpenAI service account created: ${serviceAccountId}`
            )
          } else {
            await operationManager.addOperationLog(
              operationId,
              `❌ OpenAI service account creation failed: ${serviceAccountResult.error}`
            )
            await operationManager.setOperationResult(operationId, {
              success: false,
              error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`,
            })
            return // Exit early - don't proceed with interview creation
          }
        }

        // the information that will be passed into the instance
        const instance = {
          id: interviewId,
          candidateName,
          challenge,
          password,
          openaiApiKey,
        }

        const result = await interviewManager.createInterviewWithInfrastructure(
          instance,
          (data: string) => {
            // Add each line to operation logs
            const lines = data.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              // Note: We can't await here since this is a streaming callback
              // Logs will be added asynchronously without blocking the stream
              operationManager
                .addOperationLog(operationId, line)
                .catch(console.error)
            })
          },
          (accessUrl: string) => {
            // Infrastructure is ready - update operation to show configuring status
            // Note: We can't await here since this is a streaming callback
            // Updates will be done asynchronously without blocking the stream
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
          scheduledDate,
          autoDestroyDate,
          saveFiles,
          serviceAccountId
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Interview created successfully!'
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
            '❌ Interview creation failed'
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
      operationId,
      interviewId,
      candidateName,
      challenge,
      password,
      autoDestroyAt: autoDestroyDate?.toISOString(),
      message: 'Interview creation started in background',
    })
  } catch (error: unknown) {
    console.error('Error starting interview creation:', error)

    // Check if this is a DynamoDB-related error
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack,
      })
    }

    return NextResponse.json(
      {
        error: 'Failed to start interview creation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
