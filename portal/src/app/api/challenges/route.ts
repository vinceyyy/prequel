import { NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'your-aws-region',
})

const BUCKET_NAME = 'prequel-challenge'

interface ChallengeInfo {
  id: string
  name: string
  description?: string
}

export async function GET() {
  try {
    console.log('[API] Getting available challenges from S3')

    // List objects in the S3 bucket to get available challenges
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Delimiter: '/', // This treats directories as separate items
    })

    const response = await s3Client.send(command)

    // Extract challenge names from the common prefixes (directories)
    const challenges: ChallengeInfo[] = []

    if (response.CommonPrefixes) {
      for (const prefix of response.CommonPrefixes) {
        if (prefix.Prefix) {
          // Remove trailing slash to get challenge name
          const challengeId = prefix.Prefix.replace(/\/$/, '')

          // Create a friendly name based on the challenge ID
          const friendlyName = challengeId
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')

          challenges.push({
            id: challengeId,
            name: friendlyName,
          })
        }
      }
    }

    // Sort challenges alphabetically
    challenges.sort((a, b) => a.name.localeCompare(b.name))

    console.log(
      `[API] Found ${challenges.length} challenges:`,
      challenges.map(c => c.id)
    )

    return NextResponse.json({
      success: true,
      challenges,
    })
  } catch (error) {
    console.error('[API] Error fetching challenges:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch challenges from S3',
        challenges: [],
      },
      { status: 500 }
    )
  }
}
