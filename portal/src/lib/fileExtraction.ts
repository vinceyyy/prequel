import { exec } from 'child_process'
import { promisify } from 'util'
import { ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs'
import { logger } from './logger'
import { config } from './config'

const execAsync = promisify(exec)

const ECS_CLUSTER_NAME = config.infrastructure.ecsCluster
const HISTORY_BUCKET_NAME = config.storage.historyBucket

/**
 * Default ignore patterns for files that should not be saved to S3.
 * These patterns follow gitignore-style syntax.
 */
const DEFAULT_IGNORE_PATTERNS = [
  // Dependencies
  'node_modules/**',
  '.venv/**',
  'venv/**',
  'env/**',
  '__pycache__/**',
  '*.pyc',

  // Build artifacts
  'dist/**',
  'build/**',
  '.next/**',
  'target/**',

  // IDE and system files
  '.vscode/**',
  '.idea/**',
  '.DS_Store',
  'Thumbs.db',
  '.git/**',

  // Logs
  '*.log',
  'logs/**',

  // Temporary files
  'tmp/**',
  'temp/**',
  '.tmp/**',

  // Package manager files (keep only package.json, requirements.txt, etc.)
  'package-lock.json',
  'yarn.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',
  'Cargo.lock',
]

/**
 * Configuration for file extraction from interview containers.
 */
export interface FileExtractionConfig {
  interviewId: string
  candidateName: string
  challengeId: string // Challenge ID (e.g., 'challenge-1754582796980-av473aawr')
  challengeName: string // Challenge name (e.g., 'SQL Test')
  workspaceDir?: string // Default: '/workspaces/${challengeId}'
  ignorePatterns?: string[] // Additional patterns to ignore (merged with defaults)
  maxFileSizeMB?: number // Default: 100MB total
}

/**
 * Result of file extraction and upload operation.
 */
export interface FileExtractionResult {
  success: boolean
  error?: string
  s3Key?: string // S3 key where files were uploaded (includes interview.json metadata)
  totalFiles?: number
  totalSizeBytes?: number
}

/**
 * Service for extracting candidate files from ECS containers before destruction.
 *
 * This service:
 * 1. Uses ECS Execute Command to run a file archiving script inside the container
 * 2. The script creates a tar.gz archive of workspace files (applying ignore patterns)
 * 3. Uploads the archive directly to S3 from within the container
 * 4. Creates interview metadata and uploads it alongside the files
 *
 * This approach is simpler and more reliable than trying to extract files externally.
 *
 * @example
 * ```typescript
 * const extractor = new FileExtractionService()
 * const result = await extractor.extractAndUploadFiles({
 *   interviewId: 'abc12345',
 *   candidateName: 'John Doe',
 *   challengeId: 'challenge-1754582796980-av473aawr',
 *   challengeName: 'JavaScript Test'
 * })
 *
 * if (result.success) {
 *   console.log(`Files saved to S3: ${result.s3Key}`)
 * }
 * ```
 */
export class FileExtractionService {
  private readonly ecsClient: ECSClient
  private readonly isRunningInECS: boolean
  private readonly awsProfile: string

  constructor() {
    this.isRunningInECS = !!process.env.AWS_EXECUTION_ENV
    this.awsProfile = process.env.AWS_PROFILE || 'default'

    // Initialize AWS clients with appropriate credentials
    this.ecsClient = new ECSClient(config.aws.getCredentials())
  }

  /**
   * Extracts files from the interview container workspace and uploads them to S3.
   *
   * @param config - Configuration for file extraction
   * @returns Promise with extraction result and S3 keys
   */
  async extractAndUploadFiles(
    config: FileExtractionConfig
  ): Promise<FileExtractionResult> {
    const {
      interviewId,
      candidateName,
      challengeId,
      challengeName,
      workspaceDir = `/workspaces/${challengeId}`,
      ignorePatterns = [],
      maxFileSizeMB = 100,
    } = config

    try {
      logger.info('Starting file extraction and upload', {
        interviewId,
        candidateName,
        challengeId,
        challengeName,
        workspaceDir,
      })

      // Step 1: Find the running ECS task
      const taskArn = await this.findRunningECSTask(interviewId)
      if (!taskArn) {
        return {
          success: false,
          error: 'No running ECS task found for interview',
        }
      }

      // Step 2: Generate S3 key for this interview
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
      const sanitizedName = candidateName
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s/g, '_')
      const sanitizedChallengeName = challengeName
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\s/g, '_')
      const filesS3Key = `${today}_${sanitizedName}_${sanitizedChallengeName}.tar.gz`

      // Step 3: Create and execute file extraction script inside container
      const extractionScript = this.generateExtractionScript(
        workspaceDir,
        ignorePatterns,
        maxFileSizeMB,
        HISTORY_BUCKET_NAME,
        filesS3Key,
        interviewId,
        candidateName,
        challengeId,
        challengeName
      )

      const scriptResult = await this.executeScriptInContainer(
        taskArn,
        extractionScript
      )
      if (!scriptResult.success) {
        return {
          success: false,
          error: `File extraction script failed: ${scriptResult.error}`,
        }
      }

      // Step 4: No separate metadata upload - it's included in the zip file

      logger.info('File extraction and upload completed successfully', {
        interviewId,
        s3Key: filesS3Key,
      })

      return {
        success: true,
        s3Key: filesS3Key,
        totalFiles: scriptResult.totalFiles,
        totalSizeBytes: scriptResult.totalSizeBytes,
      }
    } catch (error) {
      const errorMsg = `File extraction failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
      logger.error(errorMsg, { interviewId, error })

      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  /**
   * Finds the running ECS task for an interview.
   */
  private async findRunningECSTask(
    interviewId: string
  ): Promise<string | null> {
    try {
      const serviceName = `interview-${interviewId}`

      const response = await this.ecsClient.send(
        new ListTasksCommand({
          cluster: ECS_CLUSTER_NAME,
          serviceName,
          desiredStatus: 'RUNNING',
        })
      )

      if (response.taskArns && response.taskArns.length > 0) {
        return response.taskArns[0]
      }

      return null
    } catch (error) {
      logger.error('Failed to find ECS task', { interviewId, error })
      return null
    }
  }

  /**
   * Generates a bash script that will run inside the container to extract and upload files.
   */
  private generateExtractionScript(
    workspaceDir: string,
    customIgnorePatterns: string[],
    maxFileSizeMB: number,
    bucketName: string,
    s3Key: string,
    interviewId: string,
    candidateName: string,
    challengeId: string,
    challengeName: string
  ): string {
    const allIgnorePatterns = [
      ...DEFAULT_IGNORE_PATTERNS,
      ...customIgnorePatterns,
    ]

    // Create find exclusions for ignore patterns
    const findExclusions = allIgnorePatterns
      .map(pattern => {
        // Convert glob patterns to find -path patterns
        const findPattern = pattern.replace(/\*\*/g, '*')
        // Handle different pattern types
        if (pattern.includes('/')) {
          // Path-based pattern - match anywhere in the path
          return `-not -path "*/${findPattern}"`
        } else {
          // Name-based pattern (like *.db)
          return `-not -name "${findPattern}"`
        }
      })
      .join(' ')

    return `#!/bin/bash
set -e

WORKSPACE_DIR="${workspaceDir}"
BUCKET_NAME="${bucketName}"
S3_KEY="${s3Key}"
MAX_SIZE_MB=${maxFileSizeMB}
ARCHIVE_PATH="/tmp/workspace-archive.tar.gz"
METADATA_PATH="/tmp/interview.json"

echo "Starting file extraction from \$WORKSPACE_DIR"

# Check if workspace directory exists
echo "Checking workspace directory: \$WORKSPACE_DIR"
if [ ! -d "\$WORKSPACE_DIR" ]; then
  echo "ERROR: Workspace directory \$WORKSPACE_DIR does not exist"
  echo "Available directories in /:"
  ls -la /
  echo "Available directories in /workspaces:"
  ls -la /workspaces/ 2>/dev/null || echo "No /workspaces directory found"
  exit 1
else
  echo "✅ Workspace directory found"
fi

# Create interview metadata file
echo "Creating interview metadata..."
cat > "\$METADATA_PATH" << EOF
{
  "interviewId": "${interviewId}",
  "candidateName": "${candidateName}",
  "challenge": "${challengeName}",
  "challengeId": "${challengeId}",
  "extractedAt": "\$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "extractionVersion": "1.0.0"
}
EOF

# Find files to include (applying ignore patterns)
echo "Scanning for files to archive..."
FILES=\$(find "\$WORKSPACE_DIR" -type f ${findExclusions})

if [ -z "\$FILES" ]; then
  echo "No files found to archive"
  # Create archive structure with empty workspace folder
  TEMP_ARCHIVE_DIR="/tmp/archive_structure"
  mkdir -p "\$TEMP_ARCHIVE_DIR/workspace"
  cp "\$METADATA_PATH" "\$TEMP_ARCHIVE_DIR/interview.json"
  cd "\$TEMP_ARCHIVE_DIR"
  tar -czf "\$ARCHIVE_PATH" .
  rm -rf "\$TEMP_ARCHIVE_DIR"
  FILE_COUNT=0
  TOTAL_SIZE=\$(stat -c %s "\$METADATA_PATH")
else
  # Count files and calculate size
  FILE_COUNT=\$(echo "\$FILES" | wc -l)
  TOTAL_SIZE=\$(echo "\$FILES" | xargs stat -c %s | awk '{sum += \$1} END {print sum+0}')
  
  echo "Found \$FILE_COUNT files, total size: \$TOTAL_SIZE bytes"
  
  # Check size limit
  MAX_SIZE_BYTES=\$((MAX_SIZE_MB * 1024 * 1024))
  if [ "\$TOTAL_SIZE" -gt "\$MAX_SIZE_BYTES" ]; then
    echo "ERROR: Total file size (\$TOTAL_SIZE bytes) exceeds limit (\$MAX_SIZE_BYTES bytes)"
    exit 1
  fi
  
  # Create a temporary directory to structure the archive correctly
  TEMP_ARCHIVE_DIR="/tmp/archive_structure"
  mkdir -p "\$TEMP_ARCHIVE_DIR/workspace"
  
  # Copy all files to the workspace folder, preserving structure
  echo "\$FILES" | while IFS= read -r file; do
    if [ -n "\$file" ]; then
      # Get relative path from workspace dir
      rel_path="\${file#\$WORKSPACE_DIR/}"
      target_dir="\$TEMP_ARCHIVE_DIR/workspace/\$(dirname "\$rel_path")"
      mkdir -p "\$target_dir"
      cp "\$file" "\$target_dir/" || echo "Warning: Failed to copy \$file"
    fi
  done
  
  # Copy metadata to archive root
  cp "\$METADATA_PATH" "\$TEMP_ARCHIVE_DIR/interview.json"
  
  # Create tar from the structured directory
  cd "\$TEMP_ARCHIVE_DIR"
  tar -czf "\$ARCHIVE_PATH" . || {
    echo "ERROR: Failed to create tar archive"
    exit 1
  }
  
  # Verify archive was created
  if [ ! -f "\$ARCHIVE_PATH" ]; then
    echo "ERROR: Archive file was not created at \$ARCHIVE_PATH"
    exit 1
  fi
  
  echo "Archive created successfully: \$(ls -lh \$ARCHIVE_PATH)"
  
  # Cleanup temp structure
  rm -rf "\$TEMP_ARCHIVE_DIR"
fi

# Upload to S3
echo "Uploading archive to s3://\$BUCKET_NAME/\$S3_KEY"

# Quick upload attempt with minimal diagnostics
if aws s3 cp "\$ARCHIVE_PATH" "s3://\$BUCKET_NAME/\$S3_KEY" --region "\${AWS_REGION:-us-east-1}" 2>&1; then
  echo "✅ Upload successful"
else
  echo "S3 upload failed, trying alternative method..."
  if aws s3api put-object --bucket "\$BUCKET_NAME" --key "\$S3_KEY" --body "\$ARCHIVE_PATH" --region "\${AWS_REGION:-us-east-1}" 2>&1; then
    echo "✅ Upload succeeded with s3api method"
  else
    echo "ERROR: Both upload methods failed"
    exit 1
  fi
fi

# Verify upload succeeded
if aws s3 ls "s3://\$BUCKET_NAME/\$S3_KEY" > /dev/null 2>&1; then
  echo "✅ Archive uploaded successfully to S3"
else
  echo "ERROR: Archive upload verification failed"
  exit 1
fi

# Output results for parsing
echo "EXTRACTION_RESULT: SUCCESS"
echo "FILE_COUNT: \$FILE_COUNT"
echo "TOTAL_SIZE: \$TOTAL_SIZE"
echo "S3_LOCATION: s3://\$BUCKET_NAME/\$S3_KEY"

# Cleanup
rm -f "\$ARCHIVE_PATH" "\$METADATA_PATH"
echo "File extraction completed successfully"
`
  }

  /**
   * Executes a bash script inside the ECS container using ECS Execute Command.
   *
   * Note: This requires the AWS Session Manager plugin to be installed in the
   * portal container image. The ECS task definition has enableExecuteCommand=true
   * and the portal task role includes the necessary SSM permissions.
   */
  private async executeScriptInContainer(
    taskArn: string,
    script: string
  ): Promise<{
    success: boolean
    error?: string
    totalFiles?: number
    totalSizeBytes?: number
  }> {
    try {
      // Use AWS CLI method for ECS Execute Command
      // This works both locally (with Session Manager plugin) and in ECS (if plugin is in container)
      return await this.executeScriptViaAWSCLI(taskArn, script)
    } catch (error) {
      logger.error('Failed to execute script in container', { taskArn, error })
      return {
        success: false,
        error: `Script execution failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      }
    }
  }

  /**
   * Fallback method using AWS CLI for script execution.
   */
  private async executeScriptViaAWSCLI(
    taskArn: string,
    script: string
  ): Promise<{
    success: boolean
    error?: string
    totalFiles?: number
    totalSizeBytes?: number
  }> {
    try {
      // Write script to temporary file
      const fs = await import('fs/promises')
      const scriptPath = `/tmp/extraction-script-${Date.now()}.sh`
      await fs.writeFile(scriptPath, script, { mode: 0o755 })

      // Set up AWS environment
      const env = { ...process.env }
      if (this.isRunningInECS) {
        env.AWS_EC2_METADATA_DISABLED = 'false'
      } else {
        env.AWS_PROFILE = this.awsProfile
        env.AWS_EC2_METADATA_DISABLED = 'true'
      }

      // Execute script via AWS CLI ECS execute-command
      // Base64 encode the script and decode/execute it in the container
      const scriptContent = await fs.readFile(scriptPath, 'utf8')
      const encodedScript = Buffer.from(scriptContent).toString('base64')
      const command = `aws ecs execute-command --cluster ${ECS_CLUSTER_NAME} --task ${taskArn} --container code-server --command "/bin/sh -c 'echo ${encodedScript} | base64 -d | /bin/sh'"`

      const { stdout, stderr } = await execAsync(command, {
        env,
        timeout: 300000, // 5 minute timeout (increased from 2 minutes)
      })

      // Cleanup script file
      await fs.unlink(scriptPath).catch(() => {}) // Ignore cleanup errors

      // Parse results from script output
      const output = stdout + stderr
      if (output.includes('EXTRACTION_RESULT: SUCCESS')) {
        const fileCountMatch = output.match(/FILE_COUNT: (\d+)/)
        const totalSizeMatch = output.match(/TOTAL_SIZE: (\d+)/)

        return {
          success: true,
          totalFiles: fileCountMatch ? parseInt(fileCountMatch[1]) : 0,
          totalSizeBytes: totalSizeMatch ? parseInt(totalSizeMatch[1]) : 0,
        }
      } else {
        // Check for Session Manager plugin error
        if (output.includes('SessionManagerPlugin is not found')) {
          logger.warn(
            'Session Manager plugin not installed - file extraction skipped',
            {
              taskArn,
              output: output.substring(0, 500), // Log first 500 chars for debugging
            }
          )
          return {
            success: false,
            error:
              'Session Manager plugin not installed. File extraction requires AWS Session Manager plugin to be installed on the server. Continuing with interview destruction without file saving.',
          }
        }

        return {
          success: false,
          error: `Script execution failed: ${output}`,
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      // Check for Session Manager plugin error in exception message
      if (errorMessage.includes('SessionManagerPlugin is not found')) {
        logger.warn(
          'Session Manager plugin not installed - file extraction skipped',
          {
            taskArn,
            error: errorMessage,
          }
        )
        return {
          success: false,
          error:
            'Session Manager plugin not installed. File extraction requires AWS Session Manager plugin to be installed on the server. Continuing with interview destruction without file saving.',
        }
      }

      return {
        success: false,
        error: `AWS CLI execution failed: ${errorMessage}`,
      }
    }
  }
}

export const fileExtractionService = new FileExtractionService()
