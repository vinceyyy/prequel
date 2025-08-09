import { NextRequest, NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'

const s3Client = new S3Client(config.aws.getCredentials())
const BUCKET_NAME = config.storage.challengeBucket

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

interface FileInfo {
  name: string
  path: string
  size: number
  lastModified: string
  isDirectory: boolean
  mimeType?: string
}

/**
 * GET /api/challenges/manage/[id]/files
 * List all files in a challenge folder
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id: challengeId } = await params
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path') || '' // Optional subdirectory path

    logger.info(
      `[API] Listing files for challenge: ${challengeId}, path: ${path}`
    )

    // Construct the S3 prefix
    // Ensure path ends with / when looking inside a directory
    const cleanPath = path ? path.replace(/\/+$/, '') : '' // Remove trailing slashes
    const prefix = cleanPath
      ? `${challengeId}/${cleanPath}/`
      : `${challengeId}/`

    logger.info(
      `[API] S3 ListObjects: bucket=${BUCKET_NAME}, prefix="${prefix}"`
    )

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      Delimiter: '/', // Get immediate children only
    })

    const response = await s3Client.send(command)
    const files: FileInfo[] = []

    // Debug logging
    logger.info(
      `[API] S3 response for ${challengeId}: CommonPrefixes=${response.CommonPrefixes?.length || 0}, Contents=${response.Contents?.length || 0}, IsTruncated=${response.IsTruncated}`
    )
    if (response.Contents && response.Contents.length > 0) {
      logger.info(
        `[API] S3 keys found: ${response.Contents.map(obj => obj.Key).join(', ')}`
      )
    }

    // Add directories (common prefixes)
    if (response.CommonPrefixes) {
      for (const commonPrefix of response.CommonPrefixes) {
        if (commonPrefix.Prefix) {
          const dirName = commonPrefix.Prefix.replace(prefix, '').replace(
            /\/$/,
            ''
          )

          if (dirName) {
            // Skip empty names
            files.push({
              name: dirName,
              path: commonPrefix.Prefix.replace(`${challengeId}/`, '').replace(
                /\/+$/,
                ''
              ), // Remove trailing slash
              size: 0,
              lastModified: '',
              isDirectory: true,
            })
          }
        }
      }
    }

    // Add files
    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.Key !== prefix) {
          // Skip the prefix itself
          const fileName = object.Key.replace(prefix, '')

          if (fileName && !fileName.includes('/')) {
            // Only immediate children
            files.push({
              name: fileName,
              path: object.Key.replace(`${challengeId}/`, ''),
              size: object.Size || 0,
              lastModified: object.LastModified?.toISOString() || '',
              isDirectory: false,
              mimeType: getMimeType(fileName),
            })
          }
        }
      }
    }

    // Sort files: directories first, then files, both alphabetically
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    logger.info(
      `[API] Found ${files.length} files/folders for challenge: ${challengeId}`
    )

    return NextResponse.json({
      success: true,
      challengeId,
      path,
      files,
      count: files.length,
    })
  } catch (error) {
    const { id: paramId } = await params
    logger.error(
      `[API] Error listing files for challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to list challenge files',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Simple MIME type detection based on file extension
 */
function getMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop()

  const mimeTypes: Record<string, string> = {
    // Text files
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    yml: 'application/x-yaml',
    yaml: 'application/x-yaml',

    // Programming languages
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

    // Web files
    html: 'text/html',
    css: 'text/css',
    sql: 'text/x-sql',

    // Shell scripts
    sh: 'text/x-shellscript',
    bat: 'text/x-msdos-batch',

    // Config files
    dockerfile: 'text/x-dockerfile',
    gitignore: 'text/plain',
    env: 'text/plain',
    example: 'text/plain',
    config: 'text/plain',
  }

  return mimeTypes[extension || ''] || 'application/octet-stream'
}
