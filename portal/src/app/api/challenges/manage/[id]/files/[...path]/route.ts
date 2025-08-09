import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'

const s3Client = new S3Client(config.aws.getCredentials())
const BUCKET_NAME = config.storage.challengeBucket

interface RouteContext {
  params: Promise<{
    id: string
    path: string[]
  }>
}

/**
 * GET /api/challenges/manage/[id]/files/[...path]
 * Get the content of a specific file in a challenge
 * Query params:
 *   - download=true: Download file as attachment instead of returning JSON
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: challengeId, path } = await params
    const filePath = path.join('/')
    const { searchParams } = new URL(request.url)
    const isDownload = searchParams.get('download') === 'true'

    logger.info(
      `[API] Getting file content: ${challengeId}/${filePath}${isDownload ? ' (download)' : ' (preview)'}`
    )

    // Security: Prevent path traversal attacks
    if (
      filePath.includes('..') ||
      filePath.includes('//') ||
      filePath.startsWith('/')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid file path',
        },
        { status: 400 }
      )
    }

    const s3Key = `${challengeId}/${filePath}`

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    })

    const response = await s3Client.send(command)

    if (!response.Body) {
      return NextResponse.json(
        {
          success: false,
          error: 'File has no content',
        },
        { status: 404 }
      )
    }

    // Convert stream to string
    const chunks: Uint8Array[] = []
    const reader = response.Body.transformToWebStream().getReader()

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

    // If download is requested, return the raw file
    if (isDownload) {
      const fileName = filePath.split('/').pop() || 'file'
      const mimeType = getMimeType(filePath)

      logger.info(
        `[API] Downloading file: ${challengeId}/${filePath} (${buffer.length} bytes)`
      )

      return new Response(buffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'private, max-age=3600',
        },
      })
    }

    // Check file size (limit to 1MB for display)
    const maxTextSize = 1024 * 1024 // 1MB
    if (buffer.length > maxTextSize) {
      return NextResponse.json(
        {
          success: false,
          error: 'File too large to display',
          size: buffer.length,
          maxSize: maxTextSize,
        },
        { status: 413 }
      )
    }

    // Always try to display as UTF-8 text
    const content = buffer.toString('utf-8')
    const mimeType = getMimeType(filePath)

    logger.info(
      `[API] Retrieved file content: ${challengeId}/${filePath} (${buffer.length} bytes)`
    )

    return NextResponse.json({
      success: true,
      challengeId,
      filePath,
      content,
      size: buffer.length,
      mimeType,
      lastModified: response.LastModified?.toISOString(),
      metadata: response.Metadata || {},
    })
  } catch (error) {
    const { id, path: paramPath } = await params
    logger.error(
      `[API] Error getting file content ${id}/${paramPath.join('/')}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle S3 errors
    if (error instanceof Error) {
      if (error.name === 'NoSuchKey') {
        return NextResponse.json(
          {
            success: false,
            error: 'File not found',
          },
          { status: 404 }
        )
      }
      if (error.name === 'AccessDenied') {
        return NextResponse.json(
          {
            success: false,
            error: 'Access denied',
          },
          { status: 403 }
        )
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get file content',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Get MIME type based on file extension
 */
function getMimeType(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop()

  const mimeTypes: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    yml: 'application/x-yaml',
    yaml: 'application/x-yaml',
    js: 'text/javascript',
    ts: 'text/typescript',
    jsx: 'text/javascript',
    tsx: 'text/typescript',
    py: 'text/x-python',
    java: 'text/x-java-source',
    cpp: 'text/x-c++src',
    c: 'text/x-csrc',
    h: 'text/x-chdr',
    hpp: 'text/x-c++hdr',
    php: 'text/x-php',
    rb: 'text/x-ruby',
    go: 'text/x-go',
    rs: 'text/x-rustsrc',
    swift: 'text/x-swift',
    kt: 'text/x-kotlin',
    dart: 'text/x-dart',
    html: 'text/html',
    css: 'text/css',
    sql: 'text/x-sql',
    sh: 'text/x-shellscript',
    bat: 'text/x-msdos-batch',
    dockerfile: 'text/x-dockerfile',
  }

  return mimeTypes[extension || ''] || 'text/plain'
}
