import { NextRequest, NextResponse } from 'next/server'
import { apiKeyManager } from '@/lib/apikeys'

/**
 * GET /api/apikeys/[id]
 * Gets a single API key by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const apiKey = await apiKeyManager.getApiKey(id)

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    return NextResponse.json({ apiKey })
  } catch (error) {
    console.error('Error getting API key:', error)
    return NextResponse.json(
      { error: 'Failed to get API key' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/apikeys/[id]
 * Deletes an API key record from history
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await apiKeyManager.deleteApiKey(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting API key:', error)
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    )
  }
}
