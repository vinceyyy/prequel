import { NextRequest, NextResponse } from 'next/server'
import { apiKeyManager } from '@/lib/apikeys'
import { openaiService } from '@/lib/openai'
import { config } from '@/lib/config'

/**
 * POST /api/apikey/[token]/activate
 * Activates an API key (creates OpenAI service account)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const apiKey = await apiKeyManager.getApiKeyByToken(token)

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Invalid or expired access link' },
        { status: 404 }
      )
    }

    const now = Math.floor(Date.now() / 1000)

    // Check current status
    if (apiKey.status !== 'available') {
      if (apiKey.status === 'active') {
        // Already activated, return existing key
        return NextResponse.json({
          success: true,
          apiKey: apiKey.apiKey,
          expiresAt: apiKey.expiresAt,
          timeRemaining: apiKey.expiresAt ? apiKey.expiresAt - now : undefined,
        })
      } else if (apiKey.status === 'scheduled') {
        return NextResponse.json(
          {
            error:
              'This API key is scheduled for future availability and cannot be activated yet',
          },
          { status: 400 }
        )
      } else if (apiKey.status === 'expired') {
        return NextResponse.json(
          { error: 'This API key has expired and cannot be activated' },
          { status: 400 }
        )
      } else if (apiKey.status === 'revoked') {
        return NextResponse.json(
          { error: 'This API key has been revoked and cannot be activated' },
          { status: 400 }
        )
      } else {
        return NextResponse.json(
          {
            error: `API key cannot be activated from status: ${apiKey.status}`,
          },
          { status: 400 }
        )
      }
    }

    // Check availability window
    if (apiKey.availableUntil && apiKey.availableUntil < now) {
      await apiKeyManager.updateStatus(apiKey.id, 'expired', {
        expiredAt: now,
      })
      return NextResponse.json(
        { error: 'This API key is no longer available' },
        { status: 400 }
      )
    }

    // Create OpenAI service account
    const result = await openaiService.createServiceAccount(
      config.services.openaiProjectId,
      `interview-${config.project.environment}-apikey-${apiKey.id}-${apiKey.name}`
    )

    if (!result.success) {
      await apiKeyManager.updateStatus(apiKey.id, 'error')
      return NextResponse.json(
        { error: `Failed to create API key: ${result.error}` },
        { status: 500 }
      )
    }

    // Update key with activation details
    const expiresAt = now + apiKey.durationSeconds
    await apiKeyManager.updateStatus(apiKey.id, 'active', {
      activatedAt: now,
      expiresAt,
      serviceAccountId: result.serviceAccountId,
      apiKey: result.apiKey,
    })

    return NextResponse.json({
      success: true,
      apiKey: result.apiKey,
      expiresAt,
      timeRemaining: apiKey.durationSeconds,
    })
  } catch (error) {
    console.error('Error activating API key:', error)
    return NextResponse.json(
      { error: 'Failed to activate API key' },
      { status: 500 }
    )
  }
}
