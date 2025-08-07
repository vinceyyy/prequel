import { NextRequest, NextResponse } from 'next/server'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import { ChallengeFile } from '@/lib/challenges'

// File interface already includes webkitRelativePath
// We just need to use File directly

const s3Client = new S3Client(config.aws.getCredentials())
const BUCKET_NAME = config.storage.challengeBucket

/**
 * POST /api/challenges/manage/upload
 * Upload challenge files to S3
 *
 * Accepts multipart/form-data with:
 * - files: Multiple files to upload
 * - challengeId: Target challenge ID/folder name
 * - overwrite: Whether to overwrite existing files (default: false)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

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
      return NextResponse.json(
        {
          success: false,
          error: 'Challenge ID is required',
        },
        { status: 400 }
      )
    }

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No files provided',
        },
        { status: 400 }
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
      return NextResponse.json(
        {
          success: false,
          error: `Total upload size too large: ${Math.round(totalSize / 1024 / 1024)}MB (max: 100MB)`,
        },
        { status: 400 }
      )
    }

    if (invalidFiles.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid files detected',
          invalidFiles,
        },
        { status: 400 }
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
        return NextResponse.json(
          {
            success: false,
            error: 'Files already exist',
            existingFiles,
            message: 'Set overwrite=true to replace existing files',
          },
          { status: 409 }
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
      return NextResponse.json(
        {
          success: false,
          error: 'All file uploads failed',
          uploadErrors,
        },
        { status: 500 }
      )
    }

    logger.info(
      `[API] Successfully uploaded ${uploadedFiles.length} files for challenge: ${challengeId}`
    )

    return NextResponse.json({
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

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to upload files',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Configuration for Next.js API route to handle file uploads
 */
export const runtime = 'nodejs'
export const preferredRegion = 'auto'
