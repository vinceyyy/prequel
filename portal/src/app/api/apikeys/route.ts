import { NextResponse } from 'next/server'
import { listAllApiKeys } from '@/lib/apiKeyListService'

/**
 * GET /api/apikeys
 * Lists all API keys from all sources with orphan detection
 */
export async function GET() {
  try {
    const result = await listAllApiKeys()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error listing API keys:', error)
    return NextResponse.json(
      { error: 'Failed to list API keys' },
      { status: 500 }
    )
  }
}
