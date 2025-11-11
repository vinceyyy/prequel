// portal/src/app/api/takehomes/route.ts
import { NextResponse } from 'next/server'
import { assessmentManager } from '@/lib/assessments'

interface TakeHomeListItem {
  id: string
  candidateName?: string
  candidateEmail?: string
  challengeId: string
  sessionStatus: string
  instanceStatus: string
  createdAt: string
  availableFrom: string
  availableUntil: string
  activatedAt?: string
  accessToken: string
  url?: string
  password?: string
}

/**
 * GET /api/takehomes
 * Returns list of all take-homes for manager dashboard.
 * Take-homes are sorted by creation date descending (newest first).
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Get all take-homes from DynamoDB (already sorted by createdAt desc)
    const takeHomes = await assessmentManager.listTakeHomes()

    // Convert to API format with all fields needed for UI
    const takeHomeList: TakeHomeListItem[] = takeHomes.map(takeHome => {
      const item: TakeHomeListItem = {
        id: takeHome.id,
        candidateName: takeHome.candidateName,
        candidateEmail: takeHome.candidateEmail,
        challengeId: takeHome.challengeId,
        sessionStatus: takeHome.sessionStatus,
        instanceStatus: takeHome.instanceStatus,
        createdAt: new Date(takeHome.createdAt * 1000).toISOString(),
        availableFrom: new Date(takeHome.availableFrom * 1000).toISOString(),
        availableUntil: new Date(takeHome.availableUntil * 1000).toISOString(),
        accessToken: takeHome.accessToken,
        url: takeHome.url,
        password: takeHome.password,
      }

      // Add activatedAt if take-home has been activated
      if (takeHome.activatedAt) {
        item.activatedAt = new Date(takeHome.activatedAt * 1000).toISOString()
      }

      return item
    })

    return NextResponse.json({ takeHomes: takeHomeList })
  } catch (error) {
    console.error('Error listing take-homes:', error)
    return NextResponse.json(
      { error: 'Failed to list take-homes' },
      { status: 500 }
    )
  }
}
