import { NextRequest, NextResponse } from 'next/server'
import { apiKeyManager } from '@/lib/apikeys'
import { openaiService } from '@/lib/openai'
import { config } from '@/lib/config'

/**
 * POST /api/apikeys/[id]/revoke
 * Revokes an API key (deletes from OpenAI and marks as revoked)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Handle orphan deletion (id starts with 'orphan-')
    if (id.startsWith('orphan-')) {
      const serviceAccountId = id.replace('orphan-', '')

      if (config.services.openaiProjectId) {
        const result = await openaiService.deleteServiceAccount(
          config.services.openaiProjectId,
          serviceAccountId
        )

        if (!result.success) {
          return NextResponse.json(
            { error: `Failed to delete orphan: ${result.error}` },
            { status: 500 }
          )
        }
      }

      return NextResponse.json({ success: true })
    }

    // Handle regular API key revocation
    const apiKey = await apiKeyManager.getApiKey(id)

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    // Delete from OpenAI if service account exists
    if (apiKey.serviceAccountId && config.services.openaiProjectId) {
      const result = await openaiService.deleteServiceAccount(
        config.services.openaiProjectId,
        apiKey.serviceAccountId
      )

      if (!result.success) {
        console.error('Failed to delete OpenAI service account:', result.error)
        // Continue with status update even if OpenAI deletion fails
      }
    }

    // Update status to revoked
    const now = Math.floor(Date.now() / 1000)
    await apiKeyManager.updateStatus(apiKey.id, 'revoked', { expiredAt: now })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error revoking API key:', error)
    return NextResponse.json(
      { error: 'Failed to revoke API key' },
      { status: 500 }
    )
  }
}
