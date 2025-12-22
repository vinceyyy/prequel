import { NextRequest, NextResponse } from 'next/server'
import { apiKeyManager } from '@/lib/apikeys'

/**
 * GET /api/apikey/[token]
 * Gets API key status for candidate page (public endpoint)
 */
export async function GET(
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

    // Check if availability window has passed
    if (
      apiKey.status === 'available' &&
      apiKey.availableUntil &&
      apiKey.availableUntil < now
    ) {
      return NextResponse.json({
        key: {
          status: 'expired',
          name: apiKey.name,
        },
      })
    }

    // Calculate time remaining if active
    let timeRemaining: number | undefined
    if (apiKey.status === 'active' && apiKey.expiresAt) {
      timeRemaining = Math.max(0, apiKey.expiresAt - now)
    }

    return NextResponse.json({
      key: {
        status: apiKey.status,
        name: apiKey.name,
        apiKey: apiKey.status === 'active' ? apiKey.apiKey : undefined,
        durationSeconds: apiKey.durationSeconds,
        availableUntil: apiKey.availableUntil,
        activatedAt: apiKey.activatedAt,
        expiresAt: apiKey.expiresAt,
        expiredAt: apiKey.expiredAt,
        scheduledAt: apiKey.scheduledAt,
        timeRemaining,
      },
    })
  } catch (error) {
    console.error('Error getting API key status:', error)
    return NextResponse.json(
      { error: 'Failed to get API key status' },
      { status: 500 }
    )
  }
}
