import { NextRequest, NextResponse } from 'next/server'
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import { challengeService } from '@/lib/challenges'
import JSZip from 'jszip'

const s3Client = new S3Client(config.aws.getCredentials())
const BUCKET_NAME = config.storage.challengeBucket

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/challenges/manage/[id]/download
 * Download the entire challenge as a ZIP file
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: challengeId } = await params

    logger.info(`[API] Downloading challenge: ${challengeId}`)

    // Get challenge info to get the name
    let challengeName = 'Challenge'
    try {
      const challenge = await challengeService.getChallenge(challengeId)
      if (challenge) {
        challengeName = challenge.name
      }
    } catch (error) {
      logger.warn(
        `Failed to get challenge name for ${challengeId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    // List all files in the challenge
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${challengeId}/`,
    })

    const listResponse = await s3Client.send(listCommand)

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No files found in challenge',
        },
        { status: 404 }
      )
    }

    // Create ZIP file
    const zip = new JSZip()

    // Download and add each file to the zip
    for (const object of listResponse.Contents) {
      if (!object.Key || object.Key === `${challengeId}/`) {
        continue // Skip the folder itself
      }

      try {
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: object.Key,
        })

        const getResponse = await s3Client.send(getCommand)

        if (getResponse.Body) {
          // Convert stream to buffer
          const chunks: Uint8Array[] = []
          const reader = getResponse.Body.transformToWebStream().getReader()

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              chunks.push(value)
            }
          } finally {
            reader.releaseLock()
          }

          const buffer = Buffer.concat(chunks)

          // Get the relative path (remove challengeId prefix)
          const relativePath = object.Key.replace(`${challengeId}/`, '')

          // Add file to zip
          zip.file(relativePath, buffer)
        }
      } catch (error) {
        logger.error(
          `Failed to download file ${object.Key}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
        // Continue with other files
      }
    }

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    // Create sanitized filename
    const sanitizedName = challengeName
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50)

    logger.info(
      `[API] Generated ZIP for challenge: ${challengeId} (${zipBuffer.length} bytes)`
    )

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${sanitizedName}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    const { id: paramId } = await params
    logger.error(
      `[API] Error downloading challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to download challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
