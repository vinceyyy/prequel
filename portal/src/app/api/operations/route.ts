import { NextRequest, NextResponse } from 'next/server'
import { operationManager } from '@/lib/operations'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const interviewId = url.searchParams.get('interviewId')

    if (interviewId) {
      // Get operations for a specific interview
      const operations = operationManager.getOperationsByInterview(interviewId)
      return NextResponse.json({ operations })
    } else {
      // Get all operations
      const operations = operationManager.getAllOperations()
      return NextResponse.json({ operations })
    }
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: 'Failed to get operations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
