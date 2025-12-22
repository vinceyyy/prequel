import { NextRequest, NextResponse } from 'next/server'
import { apiKeyManager } from '@/lib/apikeys'
import { openaiService } from '@/lib/openai'
import { config } from '@/lib/config'
import { generateId } from '@/lib/idGenerator'
import type { CreateApiKeyRequest } from '@/lib/types/apikey'

/**
 * POST /api/apikeys/create
 * Creates a new standalone API key
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateApiKeyRequest = await request.json()
    const {
      name,
      description,
      activationMode,
      durationSeconds,
      scheduledAt,
      availableDays,
    } = body

    // Validation
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!durationSeconds || durationSeconds <= 0) {
      return NextResponse.json(
        { error: 'Duration is required' },
        { status: 400 }
      )
    }

    // Max duration: 7 days
    const maxDuration = 7 * 24 * 60 * 60
    if (durationSeconds > maxDuration) {
      return NextResponse.json(
        { error: 'Maximum duration is 7 days' },
        { status: 400 }
      )
    }

    // Generate ID upfront so we can use it in service account name
    const apiKeyId = generateId()
    const now = Math.floor(Date.now() / 1000)
    let status: 'scheduled' | 'available' | 'active'
    let serviceAccountId: string | undefined
    let apiKey: string | undefined
    let activatedAt: number | undefined
    let expiresAt: number | undefined
    let availableUntil: number | undefined
    let scheduledAtTimestamp: number | undefined

    if (activationMode === 'immediate') {
      // Create OpenAI service account immediately
      if (!config.services.openaiProjectId || !config.services.openaiAdminKey) {
        return NextResponse.json(
          { error: 'OpenAI not configured' },
          { status: 500 }
        )
      }

      const result = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${config.project.environment}-apikey-${apiKeyId}-${name.trim()}`
      )

      if (!result.success) {
        return NextResponse.json(
          { error: `Failed to create OpenAI key: ${result.error}` },
          { status: 500 }
        )
      }

      status = 'active'
      serviceAccountId = result.serviceAccountId
      apiKey = result.apiKey
      activatedAt = now
      expiresAt = now + durationSeconds
    } else if (activationMode === 'scheduled') {
      if (!scheduledAt) {
        return NextResponse.json(
          { error: 'scheduledAt is required for scheduled mode' },
          { status: 400 }
        )
      }

      scheduledAtTimestamp = Math.floor(new Date(scheduledAt).getTime() / 1000)
      if (scheduledAtTimestamp <= now) {
        return NextResponse.json(
          { error: 'scheduledAt must be in the future' },
          { status: 400 }
        )
      }

      status = 'scheduled'
      // expiresAt will be set when activated
    } else if (activationMode === 'recipient') {
      const days = availableDays || 7
      availableUntil = now + days * 24 * 60 * 60
      status = 'available'
      // expiresAt will be set when activated
    } else {
      return NextResponse.json(
        { error: 'Invalid activation mode' },
        { status: 400 }
      )
    }

    const createdKey = await apiKeyManager.createApiKey({
      id: apiKeyId,
      name: name.trim(),
      description: description?.trim(),
      status,
      provider: 'openai',
      activationMode,
      durationSeconds,
      serviceAccountId,
      apiKey,
      activatedAt,
      expiresAt,
      availableUntil,
      scheduledAt: scheduledAtTimestamp,
    })

    return NextResponse.json({
      success: true,
      apiKey: createdKey,
    })
  } catch (error) {
    console.error('Error creating API key:', error)
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    )
  }
}
