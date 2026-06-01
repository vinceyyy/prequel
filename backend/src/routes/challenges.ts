import { Hono } from 'hono'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import JSZip from 'jszip'
import {
  challengeService,
  getCpuCores,
  ChallengeValidator,
  CreateChallengeInput,
  UpdateChallengeInput,
  ChallengeFile,
} from '../lib/challenges'
import { logger } from '../lib/logger'
import { config } from '../lib/config'

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

interface FileInfo {
  name: string
  path: string
  size: number
  lastModified: string
  isDirectory: boolean
  mimeType?: string
}

const s3Client = new S3Client(config.aws.getCredentials())
const BUCKET_NAME = config.storage.challengeBucket

export const challengesRouter = new Hono()

/**
 * GET /api/challenges
 * Get available challenges for interview selection
 */
challengesRouter.get('/', async (c) => {
  try {
    logger.info('[API] Getting available challenges from DynamoDB')

    // Get active challenges from DynamoDB
    const challenges = await challengeService.listChallenges('newest')

    // Transform challenges for interview selection with full details
    const challengeOptions: ChallengeInfo[] = challenges.map((challenge) => ({
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

    return c.json({
      success: true,
      challenges: challengeOptions,
    })
  } catch (error) {
    logger.error(
      `[API] Error fetching challenges: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Fallback: Return empty array instead of failing completely
    // This allows the UI to continue working even if DynamoDB is unavailable
    return c.json({
      success: true, // Keep success true to avoid breaking the UI
      challenges: [],
      warning: 'Challenge database unavailable, no challenges loaded',
    })
  }
})

/**
 * GET /api/challenges/manage
 * List all challenges for management interface
 */
challengesRouter.get('/manage', async (c) => {
  try {
    const sortBy =
      (c.req.query('sortBy') as 'newest' | 'usage' | 'lastUsed') || 'newest'

    logger.info(`[API] Listing challenges for management (sortBy: ${sortBy})`)

    const challenges = await challengeService.listChallenges(sortBy)

    return c.json({
      success: true,
      challenges,
      count: challenges.length,
    })
  } catch (error) {
    logger.error(
      `[API] Error listing challenges for management: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return c.json(
      {
        success: false,
        error: 'Failed to list challenges',
        challenges: [],
      },
      500
    )
  }
})

/**
 * POST /api/challenges/manage
 * Create a new challenge
 */
challengesRouter.post('/manage', async (c) => {
  try {
    const body = await c.req.json()
    logger.info('[API] Creating new challenge:', { name: body.name })

    // Validate input
    const validationErrors = ChallengeValidator.validateCreateInput(body)
    if (validationErrors.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          validationErrors,
        },
        400
      )
    }

    const challenge = await challengeService.createChallenge(
      body as CreateChallengeInput
    )

    logger.info(`[API] Challenge created successfully: ${challenge.id}`)

    return c.json(
      {
        success: true,
        challenge,
      },
      201
    )
  } catch (error) {
    logger.error(
      `[API] Error creating challenge: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return c.json(
        {
          success: false,
          error: 'Challenge already exists',
        },
        409
      )
    }

    return c.json(
      {
        success: false,
        error: 'Failed to create challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/challenges/manage/upload
 * Upload challenge files to S3
 *
 * Accepts multipart/form-data with:
 * - files: Multiple files to upload
 * - challengeId: Target challenge ID/folder name
 * - overwrite: Whether to overwrite existing files (default: false)
 */
challengesRouter.post('/manage/upload', async (c) => {
  try {
    const formData = await c.req.formData()

    const files = formData.getAll('files') as File[]
    const filePaths = formData.getAll('filePaths') as string[]
    const challengeId = formData.get('challengeId') as string
    const overwrite = formData.get('overwrite') === 'true'

    logger.info(
      `[API] Uploading ${files.length} files for challenge: ${challengeId}`
    )

    // Debug: Log file details
    files.forEach((file, index) => {
      logger.info(
        `[API] File ${index}: name=${file.name}, relativePath=${filePaths[index] || 'undefined'}`
      )
    })

    if (!challengeId || challengeId.trim().length === 0) {
      return c.json(
        {
          success: false,
          error: 'Challenge ID is required',
        },
        400
      )
    }

    if (!files || files.length === 0) {
      return c.json(
        {
          success: false,
          error: 'No files provided',
        },
        400
      )
    }

    // Validate files (only check file size, allow all extensions)
    const maxFileSize = 10 * 1024 * 1024 // 10MB per file
    const maxTotalSize = 100 * 1024 * 1024 // 100MB total

    let totalSize = 0
    const invalidFiles: string[] = []

    for (const file of files) {
      totalSize += file.size

      // Check file size only
      if (file.size > maxFileSize) {
        invalidFiles.push(
          `${file.name} (too large: ${Math.round(file.size / 1024 / 1024)}MB)`
        )
      }
    }

    if (totalSize > maxTotalSize) {
      return c.json(
        {
          success: false,
          error: `Total upload size too large: ${Math.round(totalSize / 1024 / 1024)}MB (max: 100MB)`,
        },
        400
      )
    }

    if (invalidFiles.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Invalid files detected',
          invalidFiles,
        },
        400
      )
    }

    // Extract file paths (handle both individual files and folder structure)
    const fileData = files.map((file, index) => {
      // Use the path from filePaths array, fallback to file name
      const relativePath = filePaths[index] || file.name
      return {
        file,
        relativePath,
        s3Key: `${challengeId}/${relativePath}`,
      }
    })

    // Check for existing files if overwrite is false
    if (!overwrite) {
      const existingFiles: string[] = []
      for (const fileInfo of fileData) {
        try {
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: BUCKET_NAME,
              Key: fileInfo.s3Key,
            })
          )
          existingFiles.push(fileInfo.relativePath)
        } catch {
          // File doesn't exist, which is fine
        }
      }

      if (existingFiles.length > 0) {
        return c.json(
          {
            success: false,
            error: 'Files already exist',
            existingFiles,
            message: 'Set overwrite=true to replace existing files',
          },
          409
        )
      }
    }

    // Upload files to S3
    const uploadedFiles: ChallengeFile[] = []
    const uploadErrors: string[] = []

    for (const fileInfo of fileData) {
      try {
        const { file, relativePath, s3Key } = fileInfo
        const buffer = Buffer.from(await file.arrayBuffer())

        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: buffer,
          ContentType: file.type || 'application/octet-stream',
          Metadata: {
            originalName: file.name,
            relativePath: relativePath,
            uploadedAt: new Date().toISOString(),
            challengeId: challengeId,
          },
        })

        await s3Client.send(command)

        uploadedFiles.push({
          path: relativePath, // Store the relative path to preserve folder structure
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          lastModified: new Date(),
        })

        logger.info(`[API] Uploaded file: ${s3Key}`)
      } catch (error) {
        logger.error(
          `[API] Failed to upload file ${fileInfo.relativePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
        uploadErrors.push(
          `${fileInfo.relativePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    if (uploadErrors.length > 0 && uploadedFiles.length === 0) {
      return c.json(
        {
          success: false,
          error: 'All file uploads failed',
          uploadErrors,
        },
        500
      )
    }

    logger.info(
      `[API] Successfully uploaded ${uploadedFiles.length} files for challenge: ${challengeId}`
    )

    return c.json({
      success: true,
      challengeId,
      uploadedFiles,
      uploadErrors: uploadErrors.length > 0 ? uploadErrors : undefined,
      message:
        uploadErrors.length > 0
          ? `Partially successful: ${uploadedFiles.length} uploaded, ${uploadErrors.length} failed`
          : `Successfully uploaded ${uploadedFiles.length} files`,
    })
  } catch (error) {
    logger.error(
      `[API] Error uploading challenge files: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return c.json(
      {
        success: false,
        error: 'Failed to upload files',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * POST /api/challenges/manage/[id]/usage
 * Increment usage count for a challenge (called when used in interview creation)
 */
challengesRouter.post('/manage/:id/usage', async (c) => {
  try {
    const id = c.req.param('id')
    logger.info(`[API] Incrementing usage for challenge: ${id}`)

    await challengeService.incrementUsage(id)

    logger.info(`[API] Challenge usage incremented successfully: ${id}`)

    return c.json({
      success: true,
      message: 'Challenge usage incremented',
    })
  } catch (error) {
    const paramId = c.req.param('id')
    logger.error(
      `[API] Error incrementing usage for challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return c.json(
        {
          success: false,
          error: 'Challenge not found or inactive',
        },
        404
      )
    }

    return c.json(
      {
        success: false,
        error: 'Failed to increment challenge usage',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/challenges/manage/[id]/files/[...path]
 * Get the content of a specific file in a challenge
 * Query params:
 *   - download=true: Download file as attachment instead of returning JSON
 */
challengesRouter.get('/manage/:id/files/:path{.+}', async (c) => {
  try {
    const challengeId = c.req.param('id')
    const filePath = c.req.param('path')
    const isDownload = c.req.query('download') === 'true'

    logger.info(
      `[API] Getting file content: ${challengeId}/${filePath}${isDownload ? ' (download)' : ' (preview)'}`
    )

    // Security: Prevent path traversal attacks
    if (
      filePath.includes('..') ||
      filePath.includes('//') ||
      filePath.startsWith('/')
    ) {
      return c.json(
        {
          success: false,
          error: 'Invalid file path',
        },
        400
      )
    }

    const s3Key = `${challengeId}/${filePath}`

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    })

    const response = await s3Client.send(command)

    if (!response.Body) {
      return c.json(
        {
          success: false,
          error: 'File has no content',
        },
        404
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
      const mimeType = getFileMimeType(filePath)

      logger.info(
        `[API] Downloading file: ${challengeId}/${filePath} (${buffer.length} bytes)`
      )

      return c.body(buffer, 200, {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      })
    }

    // Check file size (limit to 1MB for display)
    const maxTextSize = 1024 * 1024 // 1MB
    if (buffer.length > maxTextSize) {
      return c.json(
        {
          success: false,
          error: 'File too large to display',
          size: buffer.length,
          maxSize: maxTextSize,
        },
        413
      )
    }

    // Always try to display as UTF-8 text
    const content = buffer.toString('utf-8')
    const mimeType = getFileMimeType(filePath)

    logger.info(
      `[API] Retrieved file content: ${challengeId}/${filePath} (${buffer.length} bytes)`
    )

    return c.json({
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
    const id = c.req.param('id')
    const paramPath = c.req.param('path')
    logger.error(
      `[API] Error getting file content ${id}/${paramPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle S3 errors
    if (error instanceof Error) {
      if (error.name === 'NoSuchKey') {
        return c.json(
          {
            success: false,
            error: 'File not found',
          },
          404
        )
      }
      if (error.name === 'AccessDenied') {
        return c.json(
          {
            success: false,
            error: 'Access denied',
          },
          403
        )
      }
    }

    return c.json(
      {
        success: false,
        error: 'Failed to get file content',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/challenges/manage/[id]/files
 * List all files in a challenge folder
 */
challengesRouter.get('/manage/:id/files', async (c) => {
  try {
    const challengeId = c.req.param('id')
    const path = c.req.query('path') || '' // Optional subdirectory path

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
        `[API] S3 keys found: ${response.Contents.map((obj) => obj.Key).join(', ')}`
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
              mimeType: getListMimeType(fileName),
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

    return c.json({
      success: true,
      challengeId,
      path,
      files,
      count: files.length,
    })
  } catch (error) {
    const paramId = c.req.param('id')
    logger.error(
      `[API] Error listing files for challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return c.json(
      {
        success: false,
        error: 'Failed to list challenge files',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/challenges/manage/[id]/download
 * Download the entire challenge as a ZIP file
 */
challengesRouter.get('/manage/:id/download', async (c) => {
  try {
    const challengeId = c.req.param('id')

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
      return c.json(
        {
          success: false,
          error: 'No files found in challenge',
        },
        404
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

    return c.body(new Uint8Array(zipBuffer), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${sanitizedName}.zip"`,
      'Content-Length': zipBuffer.length.toString(),
      'Cache-Control': 'private, max-age=3600',
    })
  } catch (error) {
    const paramId = c.req.param('id')
    logger.error(
      `[API] Error downloading challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return c.json(
      {
        success: false,
        error: 'Failed to download challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * GET /api/challenges/manage/[id]
 * Get a specific challenge by ID
 */
challengesRouter.get('/manage/:id', async (c) => {
  try {
    const id = c.req.param('id')
    logger.info(`[API] Getting challenge: ${id}`)

    const challenge = await challengeService.getChallenge(id)

    if (!challenge) {
      return c.json(
        {
          success: false,
          error: 'Challenge not found',
        },
        404
      )
    }

    return c.json({
      success: true,
      challenge,
    })
  } catch (error) {
    const paramId = c.req.param('id')
    logger.error(
      `[API] Error getting challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    return c.json(
      {
        success: false,
        error: 'Failed to get challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * PUT /api/challenges/manage/[id]
 * Update a specific challenge
 */
challengesRouter.put('/manage/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    logger.info(`[API] Updating challenge: ${id}`)

    // Validate ECS config if provided
    if (body.ecsConfig) {
      const configErrors = ChallengeValidator.validateECSConfig(body.ecsConfig)
      if (configErrors.length > 0) {
        return c.json(
          {
            success: false,
            error: 'ECS configuration validation failed',
            validationErrors: configErrors,
          },
          400
        )
      }
    }

    // Validate other fields
    const errors: string[] = []
    if (
      body.name !== undefined &&
      (!body.name || body.name.trim().length === 0)
    ) {
      errors.push('Challenge name cannot be empty')
    }
    if (
      body.description !== undefined &&
      (!body.description || body.description.trim().length === 0)
    ) {
      errors.push('Challenge description cannot be empty')
    }

    if (errors.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          validationErrors: errors,
        },
        400
      )
    }

    const updatedChallenge = await challengeService.updateChallenge(
      id,
      body as UpdateChallengeInput
    )

    logger.info(`[API] Challenge updated successfully: ${id}`)

    return c.json({
      success: true,
      challenge: updatedChallenge,
    })
  } catch (error) {
    const paramId = c.req.param('id')
    logger.error(
      `[API] Error updating challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return c.json(
        {
          success: false,
          error: 'Challenge not found or already deleted',
        },
        404
      )
    }

    return c.json(
      {
        success: false,
        error: 'Failed to update challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * DELETE /api/challenges/manage/[id]
 * Soft delete a challenge (mark as inactive)
 */
challengesRouter.delete('/manage/:id', async (c) => {
  try {
    const id = c.req.param('id')
    logger.info(`[API] Deleting challenge: ${id}`)

    await challengeService.deleteChallenge(id)

    logger.info(`[API] Challenge deleted successfully: ${id}`)

    return c.json({
      success: true,
      message: 'Challenge deleted successfully',
    })
  } catch (error) {
    const paramId = c.req.param('id')
    logger.error(
      `[API] Error deleting challenge ${paramId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )

    // Handle specific DynamoDB errors
    if (
      error instanceof Error &&
      error.message.includes('ConditionalCheckFailedException')
    ) {
      return c.json(
        {
          success: false,
          error: 'Challenge not found or already deleted',
        },
        404
      )
    }

    return c.json(
      {
        success: false,
        error: 'Failed to delete challenge',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    )
  }
})

/**
 * Simple MIME type detection based on file extension (file listing)
 */
function getListMimeType(fileName: string): string {
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

/**
 * Get MIME type based on file extension (file content)
 */
function getFileMimeType(filePath: string): string {
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
