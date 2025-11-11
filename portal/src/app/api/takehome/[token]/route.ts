// portal/src/app/api/takehome/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { assessmentManager } from '@/lib/assessments'
import type { TakeHomeSessionStatus } from '@/lib/types/assessment'

interface StatusResponse {
  sessionStatus: TakeHomeSessionStatus
  instanceStatus?: string
  accessUrl?: string
  password?: string
  activatedAt?: string
  autoDestroyAt?: string
  destroyedAt?: string
  timeRemaining?: number
  availableFrom?: string
  availableUntil?: string
  candidateName?: string
  challengeId?: string
}

/**
 * GET /api/takehome/[token]
 * Returns take-home status by access token.
 * Used by candidates to check status and get access credentials.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params

    // Look up take-home by access token
    const takeHome = await assessmentManager.getTakeHomeByToken(token)

    if (!takeHome) {
      return NextResponse.json(
        { error: 'Take-home not found' },
        { status: 404 }
      )
    }

    const now = Math.floor(Date.now() / 1000)

    // Build response based on session status
    const response: StatusResponse = {
      sessionStatus: takeHome.sessionStatus,
    }

    // Add fields based on session status
    switch (takeHome.sessionStatus) {
      case 'available':
        response.availableFrom = new Date(
          takeHome.availableFrom * 1000
        ).toISOString()
        response.availableUntil = new Date(
          takeHome.availableUntil * 1000
        ).toISOString()
        response.candidateName = takeHome.candidateName
        response.challengeId = takeHome.challengeId
        break

      case 'activated':
        response.instanceStatus = takeHome.instanceStatus
        response.activatedAt = new Date(
          takeHome.activatedAt! * 1000
        ).toISOString()
        response.autoDestroyAt = new Date(
          takeHome.autoDestroyAt! * 1000
        ).toISOString()
        response.timeRemaining = takeHome.autoDestroyAt! - now

        // Only include access credentials if instance is active
        if (takeHome.instanceStatus === 'active') {
          response.accessUrl = takeHome.url
          response.password = takeHome.password
        }
        break

      case 'completed':
        response.instanceStatus = takeHome.instanceStatus
        response.activatedAt = new Date(
          takeHome.activatedAt! * 1000
        ).toISOString()
        if (takeHome.destroyedAt) {
          response.destroyedAt = new Date(
            takeHome.destroyedAt * 1000
          ).toISOString()
        }
        break

      case 'expired':
        response.availableFrom = new Date(
          takeHome.availableFrom * 1000
        ).toISOString()
        response.availableUntil = new Date(
          takeHome.availableUntil * 1000
        ).toISOString()
        break
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching take-home status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch take-home status' },
      { status: 500 }
    )
  }
}
