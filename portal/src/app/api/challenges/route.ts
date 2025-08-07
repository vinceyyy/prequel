import { NextResponse } from 'next/server'
import { challengeService, getCpuCores } from '@/lib/challenges'
import { logger } from '@/lib/logger'

interface ChallengeInfo {
  id: string
  name: string
  description: string
  ecsConfig: {
    cpu: number
    cpuCores: number
    memory: number
    storage: number
  }
  usageCount: number
  createdAt: string
  lastUsedAt?: string
}

export async function GET() {
  try {
    logger.info('[API] Getting available challenges from DynamoDB')

    // Get active challenges from DynamoDB
    const challenges = await challengeService.listChallenges('newest')

    // Transform challenges for interview selection with full details
    const challengeOptions: ChallengeInfo[] = challenges.map(challenge => ({
      id: challenge.id,
      name: challenge.name,
      description: challenge.description,
      ecsConfig: {
        cpu: challenge.ecsConfig.cpu,
        cpuCores: getCpuCores(challenge.ecsConfig.cpu),
        memory: challenge.ecsConfig.memory,
        storage: challenge.ecsConfig.storage,
      },
      usageCount: challenge.usageCount,
      createdAt: challenge.createdAt.toISOString(),
      lastUsedAt: challenge.lastUsedAt?.toISOString(),
    }))

    logger.info(`[API] Found ${challengeOptions.length} active challenges`)

    return NextResponse.json({
      success: true,
      challenges: challengeOptions,
    })
  } catch (error) {
    logger.error(
      `[API] Error fetching challenges: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Fallback: Return empty array instead of failing completely
    // This allows the UI to continue working even if DynamoDB is unavailable
    return NextResponse.json({
      success: true, // Keep success true to avoid breaking the UI
      challenges: [],
      warning: 'Challenge database unavailable, no challenges loaded',
    })
  }
}
