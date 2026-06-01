import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { interviewManager } from '../lib/interviews'
import { operationManager } from '../lib/operations'
import { challengeService } from '../lib/challenges'
import { terraformManager } from '../lib/terraform'
import { config } from '../lib/config'
import { openaiService } from '../lib/openai'
import { generateId, generateSecureString } from '../lib/idGenerator'
import { logger } from '../lib/logger'

export const interviewsRouter = new Hono()

/**
 * GET /api/interviews — gets all active interviews from DynamoDB with
 * real-time operation status integration.
 *
 * This endpoint now uses DynamoDB as the source of truth for interview data,
 * which is much faster than the previous S3-based querying approach.
 * It integrates with ongoing operations to provide accurate real-time status.
 */
interviewsRouter.get('/', async (c) => {
  try {
    // Get active interviews from DynamoDB (fast, indexed query by status)
    const activeInterviews = await interviewManager.getActiveInterviews()

    // Get ongoing operations for real-time status overlay (using efficient GSI queries)
    const operations = await operationManager.getActiveOperations()

    // Convert DynamoDB interviews to API format
    const dynamoInterviews = activeInterviews.map((interview) => ({
      id: interview.id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      status: interview.status,
      accessUrl: interview.accessUrl,
      password: interview.password,
      createdAt: interview.createdAt.toISOString(),
      scheduledAt: interview.scheduledAt?.toISOString(),
      autoDestroyAt: interview.autoDestroyAt?.toISOString(),
    }))

    // Get interviews from active operations (for real-time status during creation)
    const operationInterviews = getOperationInterviews(operations)

    // Merge interviews with preference for DynamoDB data over operations
    const allInterviews = [...dynamoInterviews, ...operationInterviews]
    const mergedInterviews = mergeAndDeduplicateInterviews(
      allInterviews,
      operations
    )

    console.log(
      `[DEBUG] Retrieved ${activeInterviews.length} interviews from DynamoDB, ${operationInterviews.length} from operations`
    )

    return c.json({ interviews: mergedInterviews })
  } catch (error: unknown) {
    console.error('Error listing interviews:', error)

    // Return empty array to prevent UI crashes
    return c.json({ interviews: [] })
  }
})

/**
 * POST /api/interviews/create — creates a new coding interview instance.
 *
 * This endpoint provisions AWS infrastructure (ECS, ALB, Route53) for a secure,
 * isolated VS Code environment. Supports both immediate and scheduled creation
 * with mandatory auto-destroy to prevent resource waste.
 */
interviewsRouter.post('/create', async (c) => {
  try {
    const body = await c.req.json()
    const {
      candidateName,
      challenge,
      scheduledAt,
      autoDestroyMinutes,
      saveFiles = true,
    } = body

    if (!candidateName || !challenge) {
      return c.json(
        { error: 'candidateName and challenge are required' },
        400
      )
    }

    // Parse scheduled time if provided
    let scheduledDate: Date | undefined
    if (scheduledAt) {
      scheduledDate = new Date(scheduledAt)
      if (isNaN(scheduledDate.getTime())) {
        return c.json({ error: 'Invalid scheduledAt date format' }, 400)
      }

      // Ensure scheduled time is in the future (comparing UTC times)
      const now = new Date()
      if (scheduledDate <= now) {
        return c.json(
          {
            error: 'scheduledAt must be in the future',
            details: `Scheduled: ${scheduledDate.toISOString()}, Now: ${now.toISOString()}`,
          },
          400
        )
      }
    }

    // Auto-destroy is required for all interviews
    if (
      !autoDestroyMinutes ||
      typeof autoDestroyMinutes !== 'number' ||
      autoDestroyMinutes <= 0
    ) {
      return c.json(
        {
          error: 'autoDestroyMinutes is required and must be a positive number',
        },
        400
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
      const challengeRecord = challenges.find((ch) => ch.id === challenge)

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

      return c.json({
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
            `interview-${config.project.environment}-interview-${interviewId}-${candidateName}`
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
            const lines = data.split('\n').filter((line) => line.trim())
            lines.forEach((line) => {
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

    return c.json({
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

    return c.json(
      {
        error: 'Failed to start interview creation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/interviews/history — gets historical (completed/destroyed)
 * interviews from DynamoDB.
 *
 * This endpoint provides access to completed interviews for history tracking
 * and reporting purposes. It uses DynamoDB's GSI for efficient querying of
 * historical records by status.
 */
interviewsRouter.get('/history', async (c) => {
  try {
    const limitParam = c.req.query('limit')
    const candidateParam = c.req.query('candidate')

    // Parse and validate limit parameter
    let limit = 50 // Default limit
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10)
      if (!isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100) {
        limit = parsedLimit
      }
    }

    let historicalInterviews

    if (candidateParam) {
      // Search by candidate name if provided
      historicalInterviews = await interviewManager.searchByCandidate(
        candidateParam,
        limit
      )
      // Filter to only historical statuses
      historicalInterviews = historicalInterviews.filter(
        (interview) =>
          interview.status === 'destroyed' || interview.status === 'error'
      )
    } else {
      // Get all historical interviews
      historicalInterviews =
        await interviewManager.getHistoricalInterviews(limit)
    }

    // Convert to API format
    const formattedInterviews = historicalInterviews.map((interview) => ({
      id: interview.id,
      candidateName: interview.candidateName,
      challenge: interview.challenge,
      status: interview.status,
      accessUrl: interview.accessUrl,
      password: interview.password,
      createdAt: interview.createdAt.toISOString(),
      scheduledAt: interview.scheduledAt?.toISOString(),
      autoDestroyAt: interview.autoDestroyAt?.toISOString(),
      completedAt: interview.completedAt?.toISOString(),
      destroyedAt: interview.destroyedAt?.toISOString(),
      historyS3Key: interview.historyS3Key,
      saveFiles: interview.saveFiles,
    }))

    console.log(
      `[DEBUG] Retrieved ${historicalInterviews.length} historical interviews from DynamoDB` +
        (candidateParam ? ` for candidate: ${candidateParam}` : '')
    )

    return c.json({
      interviews: formattedInterviews,
      total: formattedInterviews.length,
      limit,
      hasMore: formattedInterviews.length === limit, // Indicates if there might be more results
    })
  } catch (error: unknown) {
    console.error('Error listing historical interviews:', error)

    return c.json(
      {
        error: 'Failed to retrieve historical interviews',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/interviews/:id — gets the live status of an interview directly
 * from terraform.
 */
interviewsRouter.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')

    const status = await terraformManager.getInterviewStatus(id)

    if (!status.success) {
      return c.json(
        {
          error: 'Interview not found or failed to get status',
          details: status.error,
        },
        404
      )
    }

    const outputs = status.outputs as Record<string, { value: string }>
    const interview = {
      id,
      candidateName: outputs?.candidate_name?.value || 'Unknown',
      challenge: outputs?.challenge?.value || 'unknown',
      status: 'active',
      accessUrl: outputs?.access_url?.value,
      password: outputs?.password?.value,
      createdAt: outputs?.created_at?.value || new Date().toISOString(),
    }

    return c.json({ interview })
  } catch (error: unknown) {
    return c.json(
      {
        error: 'Failed to get interview status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * DELETE /api/interviews/:id — directly destroys an interview's
 * infrastructure (no streaming).
 */
interviewsRouter.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')

    // Get interview details from the original create operation
    let candidateName: string | undefined
    let challenge: string | undefined
    let saveFiles: boolean | undefined

    try {
      const operations = await operationManager.getOperationsByInterview(id)
      const createOperation = operations.find(
        (op) => op.type === 'create' && op.status === 'completed'
      )

      if (createOperation) {
        candidateName = createOperation.candidateName
        challenge = createOperation.challenge
        saveFiles = createOperation.saveFiles
      }
    } catch (error) {
      console.log(
        'Could not retrieve create operation details for direct destroy:',
        error
      )
    }

    const result = await terraformManager.destroyInterviewStreaming(
      id,
      undefined, // No streaming callback for direct destroy
      candidateName,
      challenge,
      saveFiles
    )

    if (!result.success) {
      return c.json(
        {
          error: 'Failed to destroy interview infrastructure',
          details: result.error,
          terraformOutput: result.output,
        },
        500
      )
    }

    return c.json({
      message: 'Interview infrastructure destroyed successfully',
      terraformOutput: result.output,
    })
  } catch (error: unknown) {
    return c.json(
      {
        error: 'Failed to destroy interview',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * DELETE/POST /api/interviews/:id/destroy — destroys an interview.
 *
 * DELETE streams progress via Server-Sent Events. POST starts a background
 * destroy operation tracked via the operation manager.
 */
interviewsRouter.on(['DELETE', 'POST'], '/:id/destroy', async (c) => {
  if (c.req.method === 'DELETE') {
    const interviewId = c.req.param('id')

    if (!interviewId) {
      return c.body('Interview ID is required', 400)
    }

    return streamSSE(c, async (stream) => {
      // Get interview details from the original create operation
      let candidateName: string | undefined
      let challenge: string | undefined
      let saveFiles: boolean | undefined

      try {
        const operations =
          await operationManager.getOperationsByInterview(interviewId)
        const createOperation = operations.find(
          (op) => op.type === 'create' && op.status === 'completed'
        )

        if (createOperation) {
          candidateName = createOperation.candidateName
          challenge = createOperation.challenge
          saveFiles = createOperation.saveFiles
        }
      } catch (error) {
        console.log(
          'Could not retrieve create operation details for streaming destroy:',
          error
        )
      }

      // Send initial metadata
      const initialData = {
        type: 'metadata',
        interviewId,
        action: 'destroy',
      }
      await stream.writeSSE({ data: JSON.stringify(initialData) })

      // Start interview destroy with streaming
      await interviewManager
        .destroyInterviewWithInfrastructure(
          interviewId,
          (data: string) => {
            // Send streaming data
            const streamData = {
              type: 'output',
              data: data,
            }
            stream
              .writeSSE({ data: JSON.stringify(streamData) })
              .catch(console.error)
          },
          candidateName,
          challenge,
          saveFiles
        )
        .then(async (result) => {
          // Send final result
          const finalData = {
            type: 'complete',
            success: result.success,
            error: result.error,
            historyS3Key: result.historyS3Key,
          }
          await stream.writeSSE({ data: JSON.stringify(finalData) })
        })
        .catch(async (error) => {
          // Send error result
          const errorData = {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
          await stream.writeSSE({ data: JSON.stringify(errorData) })
        })
    })
  }

  try {
    const interviewId = c.req.param('id')

    // Get interview details from the request body for better operation tracking
    let candidateName: string | undefined
    let challenge: string | undefined
    let saveFiles: boolean | undefined

    try {
      const body = await c.req.json()
      candidateName = body.candidateName
      challenge = body.challenge
    } catch {
      // If no body provided, operation will still work but without metadata
      console.log('No interview metadata provided in destroy request')
    }

    // Try to get interview details from the original create operation
    try {
      const operations =
        await operationManager.getOperationsByInterview(interviewId)
      const createOperation = operations.find(
        (op) => op.type === 'create' && op.status === 'completed'
      )

      if (createOperation) {
        candidateName = candidateName || createOperation.candidateName
        challenge = challenge || createOperation.challenge
        saveFiles = createOperation.saveFiles // Get saveFiles from create operation
      }
    } catch (error) {
      console.log('Could not retrieve create operation details:', error)
    }

    // Cancel any scheduled operations for this interview
    const cancelledCount =
      await operationManager.cancelScheduledOperationsForInterview(interviewId)
    if (cancelledCount > 0) {
      console.log(
        `Cancelled ${cancelledCount} scheduled operations for interview ${interviewId}`
      )
    }

    // Create operation to track progress
    const operationId = await operationManager.createOperation(
      'destroy',
      interviewId,
      candidateName,
      challenge
    )

    // Start background operation
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Starting interview destruction for ${interviewId}`
        )

        if (cancelledCount > 0) {
          await operationManager.addOperationLog(
            operationId,
            `Cancelled ${cancelledCount} scheduled operation(s) for this interview`
          )
        }

        // Fetch interview record to get OpenAI service account ID
        let interview = null
        try {
          interview = await interviewManager.getInterview(interviewId)
        } catch (error) {
          console.log(
            'Could not fetch interview record for OpenAI cleanup:',
            error
          )
        }

        // Delete OpenAI service account first (before destroying infrastructure)
        if (interview?.openaiServiceAccountId) {
          await operationManager.addOperationLog(
            operationId,
            '🤖 Deleting OpenAI service account...'
          )

          const deleteResult = await openaiService.deleteServiceAccount(
            config.services.openaiProjectId,
            interview?.openaiServiceAccountId
          )

          if (deleteResult.success) {
            await operationManager.addOperationLog(
              operationId,
              `✅ OpenAI service account deleted: ${interview?.openaiServiceAccountId}`
            )
          } else {
            await operationManager.addOperationLog(
              operationId,
              `⚠️ OpenAI service account deletion failed: ${deleteResult.error}`
            )
            // Don't fail the entire destruction - continue with infrastructure cleanup
          }
        }

        // Now destroy the infrastructure
        const result =
          await interviewManager.destroyInterviewWithInfrastructure(
            interviewId,
            (data: string) => {
              // Add each line to operation logs
              const lines = data.split('\n').filter((line) => line.trim())
              lines.forEach((line) => {
                // Note: We can't await here since this is a streaming callback
                // Logs will be added asynchronously without blocking the stream
                operationManager
                  .addOperationLog(operationId, line)
                  .catch(console.error)
              })
            },
            candidateName,
            challenge,
            saveFiles
          )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Infrastructure destroyed successfully'
          )

          await operationManager.addOperationLog(
            operationId,
            '✅ Interview destroyed successfully!'
          )

          await operationManager.setOperationResult(operationId, {
            success: true,
            fullOutput: result.fullOutput,
            historyS3Key: result.historyS3Key,
          })
        } else {
          await operationManager.addOperationLog(
            operationId,
            '❌ Interview destruction failed'
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

    return c.json({
      operationId,
      interviewId,
      message: 'Interview destruction started in background',
    })
  } catch (error: unknown) {
    return c.json(
      {
        error: 'Failed to start interview destruction',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * DELETE /api/interviews/:id/delete — permanently deletes a historical
 * interview record and associated S3 files.
 */
interviewsRouter.delete('/:id/delete', async (c) => {
  try {
    const interviewId = c.req.param('id')

    if (!interviewId) {
      return c.json({ error: 'Interview ID is required' }, 400)
    }

    logger.info(`[API] Deleting interview record: ${interviewId}`)

    // Get the interview to check if it has history files
    const interview = await interviewManager.getInterview(interviewId)

    if (!interview) {
      return c.json({ error: 'Interview not found' }, 404)
    }

    // Only allow deletion of completed interviews (destroyed or error status)
    if (interview.status !== 'destroyed' && interview.status !== 'error') {
      return c.json(
        {
          error: 'Cannot delete active interview',
          details:
            'Only completed interviews (destroyed or error) can be deleted',
        },
        400
      )
    }

    // Delete history files from S3 if they exist
    if (interview.historyS3Key) {
      logger.info(`[API] Deleting history files: ${interview.historyS3Key}`)

      try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        const { config } = await import('../lib/config')

        await execAsync(
          `aws s3 rm "s3://${config.storage.historyBucket}/${interview.historyS3Key}" --recursive`,
          {
            env: process.env as NodeJS.ProcessEnv,
            timeout: 30000,
          }
        )

        logger.info(
          `[API] Successfully deleted history files: ${interview.historyS3Key}`
        )
      } catch (s3Error) {
        logger.warn(`[API] Failed to delete history files: ${s3Error}`)
        // Continue with DynamoDB deletion even if S3 cleanup fails
      }
    }

    // Delete the interview record from DynamoDB
    await interviewManager.deleteInterview(interviewId)

    logger.info(`[API] Successfully deleted interview: ${interviewId}`)

    return c.json({
      success: true,
      message: 'Interview deleted successfully',
      deletedHistoryFiles: !!interview.historyS3Key,
    })
  } catch (error) {
    logger.error(
      `[API] Error deleting interview: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return c.json(
      {
        error: 'Failed to delete interview',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/interviews/:id/files — downloads candidate files from S3 for a
 * completed interview as a tar.gz archive.
 */
interviewsRouter.get('/:id/files', async (c) => {
  try {
    const interviewId = c.req.param('id')

    if (!interviewId) {
      return c.json({ error: 'Interview ID is required' }, 400)
    }

    // Get interview from DynamoDB to verify it exists and has saved files
    const interview = await interviewManager.getInterview(interviewId)

    if (!interview) {
      return c.json({ error: 'Interview not found' }, 404)
    }

    // Check if files were supposed to be saved
    if (!interview.saveFiles) {
      return c.json(
        {
          error: 'Files were not saved for this interview',
          details: 'File saving was disabled when the interview was created',
        },
        400
      )
    }

    if (!interview.historyS3Key) {
      return c.json(
        {
          error: 'Saved files are not yet available',
          details:
            'Files may still be processing or the extraction failed during interview destruction',
        },
        404
      )
    }

    // Import AWS SDK for S3 operations
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
    const { config } = await import('../lib/config')

    const s3Client = new S3Client(config.aws.getCredentials())
    const bucketName = config.storage.historyBucket

    try {
      // Get the tar.gz file from S3
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: interview.historyS3Key,
      })

      const response = await s3Client.send(command)

      if (!response.Body) {
        return c.json({ error: 'File not found in S3' }, 404)
      }

      // Convert the S3 stream to a buffer
      const chunks: Uint8Array[] = []
      const reader = response.Body.transformToWebStream().getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      const buffer = Buffer.concat(chunks)

      // Get challenge name from challenge ID
      let challengeName = 'Unknown_Challenge'
      try {
        const challenge = await challengeService.getChallenge(
          interview.challenge
        )
        if (challenge) {
          challengeName = challenge.name
        }
      } catch (error) {
        console.warn(
          `Failed to get challenge name for ${interview.challenge}:`,
          error
        )
      }

      // Generate filename with date, candidate name, and challenge name
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
      const sanitizedCandidateName = interview.candidateName
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s/g, '_')
        .substring(0, 50)
      const sanitizedChallengeName = challengeName
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s/g, '_')
        .substring(0, 50)
      // Use hyphens to separate parts for better readability
      const filename = `${today}-${sanitizedCandidateName}-${sanitizedChallengeName}.tar.gz`

      // Return the tar.gz file as a download
      return c.body(buffer, 200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
      })
    } catch (s3Error) {
      console.error('Failed to download file from S3:', s3Error)

      if (s3Error instanceof Error && s3Error.name === 'NoSuchKey') {
        return c.json(
          {
            error: 'Saved files not found',
            details:
              'The saved files may have been automatically cleaned up or corrupted',
          },
          404
        )
      }

      return c.json(
        {
          error: 'Failed to download saved files',
          details: 'An error occurred while retrieving files from storage',
        },
        500
      )
    }
  } catch (error: unknown) {
    console.error('Error downloading interview files:', error)

    return c.json(
      {
        error: 'Failed to process file download request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/interviews/:id/health-check — retries the health check for an
 * interview instance whose initial health check failed.
 */
interviewsRouter.post('/:id/health-check', async (c) => {
  try {
    const interviewId = c.req.param('id')

    if (!interviewId) {
      return c.json({ error: 'Interview ID is required' }, 400)
    }

    // Find the create operation for this interview
    const operations =
      await operationManager.getOperationsByInterview(interviewId)
    const createOperation = operations.find((op) => op.type === 'create')

    if (!createOperation) {
      return c.json(
        { error: 'No create operation found for this interview' },
        404
      )
    }

    if (
      createOperation.status !== 'completed' ||
      !createOperation.result?.success
    ) {
      return c.json(
        { error: 'Interview creation is not completed successfully' },
        400
      )
    }

    // Create a new operation to track the health check retry
    const operationId = await operationManager.createOperation(
      'create',
      interviewId,
      createOperation.candidateName,
      createOperation.challenge
    )

    // Start background health check retry
    setImmediate(async () => {
      try {
        await operationManager.updateOperationStatus(operationId, 'running')
        await operationManager.addOperationLog(
          operationId,
          `Retrying health check for interview ${interviewId}`
        )

        const result = await terraformManager.retryHealthCheck(
          interviewId,
          (data: string) => {
            const lines = data.split('\n').filter((line) => line.trim())
            lines.forEach((line) => {
              // Note: We can't await here since this is a streaming callback
              // Logs will be added asynchronously without blocking the stream
              operationManager
                .addOperationLog(operationId, line)
                .catch(console.error)
            })
          }
        )

        if (result.success) {
          await operationManager.addOperationLog(
            operationId,
            '✅ Health check retry successful!'
          )

          // Update the original operation's result to mark health check as passed
          const originalResult = createOperation.result
          if (originalResult) {
            originalResult.healthCheckPassed = true
            await operationManager.setOperationResult(
              createOperation.id,
              originalResult
            )
          }

          await operationManager.setOperationResult(operationId, {
            success: true,
            accessUrl: result.accessUrl,
            password: createOperation.result?.password,
            healthCheckPassed: true,
          })
        } else {
          await operationManager.addOperationLog(
            operationId,
            '❌ Health check retry failed'
          )
          await operationManager.addOperationLog(
            operationId,
            `Error: ${result.error}`
          )

          await operationManager.setOperationResult(operationId, {
            success: false,
            error: result.error,
            healthCheckPassed: false,
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
          healthCheckPassed: false,
        })
      }
    })

    return c.json({
      operationId,
      interviewId,
      message: 'Health check retry started in background',
    })
  } catch (error: unknown) {
    return c.json(
      {
        error: 'Failed to start health check retry',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * Converts operation data into interview format with proper status mapping.
 *
 * Maps operation statuses to interview statuses:
 * - scheduled → scheduled (waiting for scheduled time)
 * - pending → initializing (operation not yet started)
 * - running + !infrastructureReady → initializing (Terraform provisioning resources)
 * - running + infrastructureReady → configuring (ECS container booting up)
 * - completed + success + healthCheckPassed → active (fully ready)
 * - completed + success + !healthCheckPassed → configuring (infrastructure ready but service not accessible)
 * - completed + !success → error (creation failed)
 * - failed → error (operation failed)
 */
function getOperationInterviews(
  operations: Array<{
    id: string
    type: string
    interviewId: string
    candidateName?: string
    challenge?: string
    status: string
    scheduledAt?: Date
    autoDestroyAt?: Date
    result?: {
      success: boolean
      accessUrl?: string
      password?: string
      healthCheckPassed?: boolean
      infrastructureReady?: boolean
    }
    createdAt: Date
  }>
) {
  return operations
    .filter((op) => op.type === 'create')
    .map((op) => ({
      id: op.interviewId,
      candidateName: op.candidateName || 'Unknown',
      challenge: op.challenge || 'unknown',
      status:
        op.status === 'scheduled'
          ? 'scheduled'
          : op.status === 'pending'
            ? 'initializing'
            : op.status === 'running'
              ? op.result?.infrastructureReady
                ? 'configuring' // Infrastructure ready, ECS container booting up
                : 'initializing' // Still running Terraform to provision resources
              : op.status === 'completed'
                ? op.result?.success
                  ? op.result?.healthCheckPassed
                    ? 'active'
                    : 'configuring' // Infrastructure created but health check failed
                  : 'error'
                : 'error',
      accessUrl: op.result?.accessUrl,
      password: op.result?.password || '',
      createdAt: op.createdAt.toISOString(),
      scheduledAt: op.scheduledAt?.toISOString(),
      autoDestroyAt: op.autoDestroyAt?.toISOString(),
      operationId: op.id,
    }))
}

/**
 * Merges interviews from DynamoDB and operations with destroy status updates.
 *
 * Handles deduplication by:
 * - Preferring DynamoDB data over operations (DynamoDB is source of truth)
 * - Applying latest destroy operation status updates for real-time feedback
 * - Filtering out destroyed interviews (they're moved to history)
 * - Sorting by creation time (newest first)
 */
function mergeAndDeduplicateInterviews(
  allInterviews: Array<{
    id: string
    candidateName: string
    challenge: string
    status: string
    accessUrl?: string
    password?: string
    createdAt: string
    scheduledAt?: string
    autoDestroyAt?: string
  }>,
  operations: Array<{
    type: string
    interviewId: string
    status: string
    result?: {
      success: boolean
      healthCheckPassed?: boolean
    }
    createdAt: Date
  }>
) {
  // Build map of latest destroy operations by interview ID
  const destroyOperationUpdates = new Map()
  operations
    .filter((op) => op.type === 'destroy')
    .forEach((op) => {
      const existing = destroyOperationUpdates.get(op.interviewId)
      if (!existing || op.createdAt.getTime() > existing.createdAt.getTime()) {
        destroyOperationUpdates.set(op.interviewId, op)
      }
    })

  const interviewMap = new Map()

  // Add all interviews with deduplication preference for DynamoDB data
  allInterviews.forEach((interview) => {
    const existing = interviewMap.get(interview.id)

    // Prefer interviews with access URLs (more complete data)
    if (existing && existing.accessUrl && !interview.accessUrl) {
      return // Keep the one with access URL
    }

    // Prefer active status over non-active
    if (
      existing &&
      existing.status === 'active' &&
      interview.status !== 'active'
    ) {
      return // Keep the active one
    }

    interviewMap.set(interview.id, interview)
  })

  // Apply destroy operation status updates for real-time feedback
  destroyOperationUpdates.forEach((destroyOp, interviewId) => {
    const existing = interviewMap.get(interviewId)
    if (existing) {
      const updatedInterview = {
        ...existing,
        status:
          destroyOp.status === 'running'
            ? 'destroying'
            : destroyOp.status === 'failed'
              ? 'error'
              : destroyOp.status === 'completed'
                ? destroyOp.result?.success
                  ? 'destroyed'
                  : 'error'
                : existing.status,
      }
      interviewMap.set(interviewId, updatedInterview)
    }
  })

  // Filter out destroyed interviews and sort by creation time
  return Array.from(interviewMap.values())
    .filter((interview) => interview.status !== 'destroyed')
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
}
