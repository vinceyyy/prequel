import { NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'your-aws-region',
})

const BUCKET_NAME = 'prequel-scenario'

interface ScenarioInfo {
  id: string
  name: string
  description?: string
}

export async function GET() {
  try {
    console.log('[API] Getting available scenarios from S3')

    // List objects in the S3 bucket to get available scenarios
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Delimiter: '/', // This treats directories as separate items
    })

    const response = await s3Client.send(command)

    // Extract scenario names from the common prefixes (directories)
    const scenarios: ScenarioInfo[] = []

    if (response.CommonPrefixes) {
      for (const prefix of response.CommonPrefixes) {
        if (prefix.Prefix) {
          // Remove trailing slash to get scenario name
          const scenarioId = prefix.Prefix.replace(/\/$/, '')

          // Create a friendly name based on the scenario ID
          const friendlyName = scenarioId
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')

          scenarios.push({
            id: scenarioId,
            name: friendlyName,
          })
        }
      }
    }

    // Sort scenarios alphabetically
    scenarios.sort((a, b) => a.name.localeCompare(b.name))

    console.log(
      `[API] Found ${scenarios.length} scenarios:`,
      scenarios.map(s => s.id)
    )

    return NextResponse.json({
      success: true,
      scenarios,
    })
  } catch (error) {
    console.error('[API] Error fetching scenarios:', error)

    // Return fallback scenarios if S3 fails
    const fallbackScenarios: ScenarioInfo[] = [
      { id: 'python', name: 'Python' },
      { id: 'javascript', name: 'JavaScript' },
      { id: 'sql', name: 'SQL' },
    ]

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch scenarios from S3',
        scenarios: fallbackScenarios,
      },
      { status: 500 }
    )
  }
}
