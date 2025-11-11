// portal/src/app/api/takehomes/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { assessmentManager } from '@/lib/assessments'
import { openaiService } from '@/lib/openai'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import type { TakeHome } from '@/lib/types/assessment'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      candidateName,
      candidateEmail,
      challengeId,
      availableDays = 7,
      durationHours = 4, // eslint-disable-line @typescript-eslint/no-unused-vars
      additionalInstructions,
    } = body

    // Validate required fields
    if (!candidateName || !challengeId) {
      return NextResponse.json(
        { error: 'candidateName and challengeId are required' },
        { status: 400 }
      )
    }

    // Generate IDs
    const takeHomeId = uuidv4()
    const accessToken = uuidv4().substring(0, 8) // Short token for cleaner URLs

    // Calculate timestamps
    const now = Math.floor(Date.now() / 1000)
    const availableFrom = now
    const availableUntil = now + availableDays * 24 * 60 * 60

    // Create OpenAI service account if configured
    let openaiServiceAccount
    try {
      const serviceAccountResult = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `takehome-${takeHomeId}`
      )
      if (
        serviceAccountResult.success &&
        serviceAccountResult.apiKey &&
        serviceAccountResult.serviceAccountId
      ) {
        openaiServiceAccount = {
          apiKey: serviceAccountResult.apiKey,
          projectId: config.services.openaiProjectId,
          serviceAccountId: serviceAccountResult.serviceAccountId,
        }
      }
    } catch (error) {
      logger.warn('Failed to create OpenAI service account', {
        takeHomeId,
        error,
      })
    }

    // Create take-home record
    const takeHome: Omit<TakeHome, 'createdAt'> = {
      PK: `TAKEHOME#${takeHomeId}`,
      SK: 'METADATA',
      sessionType: 'takehome',
      id: takeHomeId,
      accessToken,
      availableFrom,
      availableUntil,
      isActivated: false,
      sessionStatus: 'available',
      createdBy: 'admin', // TODO: Get from auth context
      candidateName,
      candidateEmail,
      additionalInstructions,
      instanceStatus: 'pending',
      challengeId,
      autoDestroyAt: undefined, // Set when activated
      resourceConfig: {
        cpu: 1024, // TODO: Get from challenge config
        memory: 2048,
        storage: 20,
      },
      openaiServiceAccount,
    }

    await assessmentManager.createTakeHome(takeHome)

    // Generate access URL
    const protocol = request.headers.get('x-forwarded-proto') || 'http'
    const host = request.headers.get('host') || 'localhost'
    const accessUrl = `${protocol}://${host}/takehome/${accessToken}`

    logger.info('Take-home created', {
      takeHomeId,
      candidateName,
      accessUrl,
    })

    return NextResponse.json({
      success: true,
      takeHomeId,
      accessToken,
      accessUrl,
      availableFrom: new Date(availableFrom * 1000).toISOString(),
      availableUntil: new Date(availableUntil * 1000).toISOString(),
    })
  } catch (error) {
    logger.error('Failed to create take-home', { error })
    return NextResponse.json(
      {
        error: 'Failed to create take-home',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
