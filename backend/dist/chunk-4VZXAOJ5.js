import {
  logger
} from "./chunk-QOQWQKGY.js";
import {
  config
} from "./chunk-BJRZHASW.js";

// src/lib/terraform.ts
import { exec as exec2, spawn } from "child_process";
import { promisify as promisify2 } from "util";
import path from "path";
import fs from "fs/promises";

// src/lib/fileExtraction.ts
import { exec } from "child_process";
import { promisify } from "util";
import { ECSClient, ListTasksCommand } from "@aws-sdk/client-ecs";
var execAsync = promisify(exec);
var ECS_CLUSTER_NAME = config.infrastructure.ecsCluster;
var HISTORY_BUCKET_NAME = config.storage.historyBucket;
var DEFAULT_IGNORE_PATTERNS = [
  // Dependencies
  "node_modules/**",
  ".venv/**",
  "venv/**",
  "env/**",
  "__pycache__/**",
  "*.pyc",
  // Build artifacts
  "dist/**",
  "build/**",
  ".next/**",
  "target/**",
  // IDE and system files
  ".vscode/**",
  ".idea/**",
  ".DS_Store",
  "Thumbs.db",
  ".git/**",
  // Logs
  "*.log",
  "logs/**",
  // Temporary files
  "tmp/**",
  "temp/**",
  ".tmp/**",
  // Package manager files (keep only package.json, requirements.txt, etc.)
  "package-lock.json",
  "yarn.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock"
];
var FileExtractionService = class {
  ecsClient;
  isRunningInECS;
  awsProfile;
  constructor() {
    this.isRunningInECS = !!process.env.AWS_EXECUTION_ENV;
    this.awsProfile = process.env.AWS_PROFILE || "default";
    this.ecsClient = new ECSClient(config.aws.getCredentials());
  }
  /**
   * Extracts files from the interview container workspace and uploads them to S3.
   *
   * @param config - Configuration for file extraction
   * @returns Promise with extraction result and S3 keys
   */
  async extractAndUploadFiles(config2) {
    const {
      interviewId,
      candidateName,
      challengeId,
      challengeName,
      workspaceDir = `/workspaces/${challengeId}`,
      ignorePatterns = [],
      maxFileSizeMB = 100
    } = config2;
    try {
      logger.info("Starting file extraction and upload", {
        interviewId,
        candidateName,
        challengeId,
        challengeName,
        workspaceDir
      });
      const taskArn = await this.findRunningECSTask(interviewId);
      if (!taskArn) {
        return {
          success: false,
          error: "No running ECS task found for interview"
        };
      }
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
      const sanitizedName = candidateName.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim().replace(/\s/g, "_");
      const sanitizedChallengeName = challengeName.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim().replace(/\s/g, "_");
      const filesS3Key = `${today}-${sanitizedName}-${sanitizedChallengeName}.tar.gz`;
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
      );
      const scriptResult = await this.executeScriptInContainer(
        taskArn,
        extractionScript
      );
      if (!scriptResult.success) {
        return {
          success: false,
          error: `File extraction script failed: ${scriptResult.error}`
        };
      }
      logger.info("File extraction and upload completed successfully", {
        interviewId,
        s3Key: filesS3Key
      });
      return {
        success: true,
        s3Key: filesS3Key,
        totalFiles: scriptResult.totalFiles,
        totalSizeBytes: scriptResult.totalSizeBytes
      };
    } catch (error) {
      const errorMsg = `File extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      logger.error(errorMsg, { interviewId, error });
      return {
        success: false,
        error: errorMsg
      };
    }
  }
  /**
   * Finds the running ECS task for an interview.
   */
  async findRunningECSTask(interviewId) {
    try {
      const serviceName = `interview-${interviewId}`;
      const response = await this.ecsClient.send(
        new ListTasksCommand({
          cluster: ECS_CLUSTER_NAME,
          serviceName,
          desiredStatus: "RUNNING"
        })
      );
      if (response.taskArns && response.taskArns.length > 0) {
        return response.taskArns[0];
      }
      return null;
    } catch (error) {
      logger.error("Failed to find ECS task", { interviewId, error });
      return null;
    }
  }
  /**
   * Generates a bash script that will run inside the container to extract and upload files.
   */
  generateExtractionScript(workspaceDir, customIgnorePatterns, maxFileSizeMB, bucketName, s3Key, interviewId, candidateName, challengeId, challengeName) {
    const allIgnorePatterns = [
      ...DEFAULT_IGNORE_PATTERNS,
      ...customIgnorePatterns
    ];
    const findExclusions = allIgnorePatterns.map((pattern) => {
      const findPattern = pattern.replace(/\*\*/g, "*");
      if (pattern.includes("/")) {
        return `-not -path "*/${findPattern}"`;
      } else {
        return `-not -name "${findPattern}"`;
      }
    }).join(" ");
    return `#!/bin/bash
set -e

WORKSPACE_DIR="${workspaceDir}"
BUCKET_NAME="${bucketName}"
S3_KEY="${s3Key}"
MAX_SIZE_MB=${maxFileSizeMB}
ARCHIVE_PATH="/tmp/workspace-archive.tar.gz"
METADATA_PATH="/tmp/interview.json"

echo "Starting file extraction from $WORKSPACE_DIR"

# Check if workspace directory exists
echo "Checking workspace directory: $WORKSPACE_DIR"
if [ ! -d "$WORKSPACE_DIR" ]; then
  echo "ERROR: Workspace directory $WORKSPACE_DIR does not exist"
  echo "Available directories in /:"
  ls -la /
  echo "Available directories in /workspaces:"
  ls -la /workspaces/ 2>/dev/null || echo "No /workspaces directory found"
  exit 1
else
  echo "\u2705 Workspace directory found"
fi

# Create interview metadata file
echo "Creating interview metadata..."
cat > "$METADATA_PATH" << EOF
{
  "interviewId": "${interviewId}",
  "candidateName": "${candidateName}",
  "challenge": "${challengeName}",
  "challengeId": "${challengeId}",
  "extractedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "extractionVersion": "1.0.0"
}
EOF

# Find files to include (applying ignore patterns)
echo "Scanning for files to archive..."
FILES=$(find "$WORKSPACE_DIR" -type f ${findExclusions})

if [ -z "$FILES" ]; then
  echo "No files found to archive"
  # Create archive structure with empty workspace folder
  TEMP_ARCHIVE_DIR="/tmp/archive_structure"
  mkdir -p "$TEMP_ARCHIVE_DIR/workspace"
  cp "$METADATA_PATH" "$TEMP_ARCHIVE_DIR/interview.json"
  cd "$TEMP_ARCHIVE_DIR"
  tar -czf "$ARCHIVE_PATH" .
  rm -rf "$TEMP_ARCHIVE_DIR"
  FILE_COUNT=0
  TOTAL_SIZE=$(stat -c %s "$METADATA_PATH")
else
  # Count files and calculate size
  FILE_COUNT=$(echo "$FILES" | wc -l)
  TOTAL_SIZE=$(echo "$FILES" | xargs stat -c %s | awk '{sum += $1} END {print sum+0}')
  
  echo "Found $FILE_COUNT files, total size: $TOTAL_SIZE bytes"
  
  # Check size limit
  MAX_SIZE_BYTES=$((MAX_SIZE_MB * 1024 * 1024))
  if [ "$TOTAL_SIZE" -gt "$MAX_SIZE_BYTES" ]; then
    echo "ERROR: Total file size ($TOTAL_SIZE bytes) exceeds limit ($MAX_SIZE_BYTES bytes)"
    exit 1
  fi
  
  # Create a temporary directory to structure the archive correctly
  TEMP_ARCHIVE_DIR="/tmp/archive_structure"
  mkdir -p "$TEMP_ARCHIVE_DIR/workspace"
  
  # Copy all files to the workspace folder, preserving structure
  echo "$FILES" | while IFS= read -r file; do
    if [ -n "$file" ]; then
      # Get relative path from workspace dir
      rel_path="\${file#$WORKSPACE_DIR/}"
      target_dir="$TEMP_ARCHIVE_DIR/workspace/$(dirname "$rel_path")"
      mkdir -p "$target_dir"
      cp "$file" "$target_dir/" || echo "Warning: Failed to copy $file"
    fi
  done
  
  # Copy metadata to archive root
  cp "$METADATA_PATH" "$TEMP_ARCHIVE_DIR/interview.json"
  
  # Create tar from the structured directory
  cd "$TEMP_ARCHIVE_DIR"
  tar -czf "$ARCHIVE_PATH" . || {
    echo "ERROR: Failed to create tar archive"
    exit 1
  }
  
  # Verify archive was created
  if [ ! -f "$ARCHIVE_PATH" ]; then
    echo "ERROR: Archive file was not created at $ARCHIVE_PATH"
    exit 1
  fi
  
  echo "Archive created successfully: $(ls -lh $ARCHIVE_PATH)"
  
  # Cleanup temp structure
  rm -rf "$TEMP_ARCHIVE_DIR"
fi

# Upload to S3
echo "Uploading archive to s3://$BUCKET_NAME/$S3_KEY"

# Use s3api put-object directly (more reliable and doesn't trigger session termination)
echo "Using s3api put-object for upload..."
S3API_OUTPUT=$(aws s3api put-object --bucket "$BUCKET_NAME" --key "$S3_KEY" --body "$ARCHIVE_PATH" --region "\${AWS_REGION:-us-east-1}" 2>&1 || true)
echo "S3API output: $S3API_OUTPUT"

# Check if upload succeeded by looking for ETag in response
if echo "$S3API_OUTPUT" | grep -q "ETag"; then
  echo "\u2705 Upload succeeded"
  echo "File uploaded to: s3://$BUCKET_NAME/$S3_KEY"
else
  echo "WARNING: Upload may have failed - no ETag in response"
  echo "Attempting fallback with s3 cp..."
  S3_CP_OUTPUT=$(aws s3 cp "$ARCHIVE_PATH" "s3://$BUCKET_NAME/$S3_KEY" --region "\${AWS_REGION:-us-east-1}" 2>&1 || true)
  echo "S3 cp output: $S3_CP_OUTPUT"
fi

# Output results for parsing
echo "EXTRACTION_RESULT: SUCCESS"
echo "FILE_COUNT: $FILE_COUNT"
echo "TOTAL_SIZE: $TOTAL_SIZE"
echo "S3_LOCATION: s3://$BUCKET_NAME/$S3_KEY"

# Cleanup
rm -f "$ARCHIVE_PATH" "$METADATA_PATH"
echo "File extraction completed successfully"
`;
  }
  /**
   * Executes a bash script inside the ECS container using ECS Execute Command.
   *
   * Note: This requires the AWS Session Manager plugin to be installed in the
   * portal container image. The ECS task definition has enableExecuteCommand=true
   * and the portal task role includes the necessary SSM permissions.
   */
  async executeScriptInContainer(taskArn, script) {
    try {
      return await this.executeScriptViaAWSCLI(taskArn, script);
    } catch (error) {
      logger.error("Failed to execute script in container", { taskArn, error });
      return {
        success: false,
        error: `Script execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
  /**
   * Fallback method using AWS CLI for script execution.
   */
  async executeScriptViaAWSCLI(taskArn, script) {
    try {
      const fs2 = await import("fs/promises");
      const scriptPath = `/tmp/extraction-script-${Date.now()}.sh`;
      await fs2.writeFile(scriptPath, script, { mode: 493 });
      const env = { ...process.env };
      if (this.isRunningInECS) {
        env.AWS_EC2_METADATA_DISABLED = "false";
      } else {
        env.AWS_PROFILE = this.awsProfile;
        env.AWS_EC2_METADATA_DISABLED = "true";
      }
      const scriptContent = await fs2.readFile(scriptPath, "utf8");
      const encodedScript = Buffer.from(scriptContent).toString("base64");
      const command = `aws ecs execute-command --cluster ${ECS_CLUSTER_NAME} --task ${taskArn} --container code-server --interactive --command "/bin/sh -c 'echo ${encodedScript} | base64 -d | /bin/sh'"`;
      const { stdout, stderr } = await execAsync(command, {
        env,
        timeout: 3e5
        // 5 minute timeout (increased from 2 minutes)
      });
      await fs2.unlink(scriptPath).catch(() => {
      });
      const output = stdout + stderr;
      const uploadSuccessful = output.includes("EXTRACTION_RESULT: SUCCESS") || output.includes("\u2705 Upload succeeded") || output.includes("ETag") || // S3API returns ETag on success
      output.includes("Archive created successfully") && output.includes("S3API output:");
      if (uploadSuccessful) {
        const fileCountMatch = output.match(/FILE_COUNT: (\d+)/);
        const totalSizeMatch = output.match(/TOTAL_SIZE: (\d+)/);
        return {
          success: true,
          totalFiles: fileCountMatch ? parseInt(fileCountMatch[1]) : 0,
          totalSizeBytes: totalSizeMatch ? parseInt(totalSizeMatch[1]) : 0
        };
      } else {
        if (output.includes("SessionManagerPlugin is not found")) {
          logger.warn(
            "Session Manager plugin not installed - file extraction skipped",
            {
              taskArn,
              output: output.substring(0, 500)
              // Log first 500 chars for debugging
            }
          );
          return {
            success: false,
            error: "Session Manager plugin not installed. File extraction requires AWS Session Manager plugin to be installed on the server. Continuing with interview destruction without file saving."
          };
        }
        return {
          success: false,
          error: `Script execution failed: ${output}`
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      if (errorMessage.includes("SessionManagerPlugin is not found")) {
        logger.warn(
          "Session Manager plugin not installed - file extraction skipped",
          {
            taskArn,
            error: errorMessage
          }
        );
        return {
          success: false,
          error: "Session Manager plugin not installed. File extraction requires AWS Session Manager plugin to be installed on the server. Continuing with interview destruction without file saving."
        };
      }
      return {
        success: false,
        error: `AWS CLI execution failed: ${errorMessage}`
      };
    }
  }
};
var fileExtractionService = new FileExtractionService();

// src/lib/challenges.ts
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var dynamoClient = new DynamoDBClient(config.aws.getCredentials());
var ChallengeService = class {
  tableName = config.database.challengesTable;
  /**
   * Convert DynamoDB item timestamps back to Date objects.
   */
  convertTimestampsToDate(item) {
    return {
      ...item,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
      lastUsedAt: item.lastUsedAt ? new Date(item.lastUsedAt) : void 0
    };
  }
  /**
   * Create a new challenge in the database.
   */
  async createChallenge(input) {
    const now = /* @__PURE__ */ new Date();
    const challenge = {
      id: input.id || `challenge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: input.name,
      description: input.description,
      isActive: "true",
      files: input.files,
      ecsConfig: input.ecsConfig,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      ttl: Math.floor(now.getTime() / 1e3) + 90 * 24 * 60 * 60
      // 90 days
    };
    const challengeForStorage = {
      ...challenge,
      createdAt: challenge.createdAt.getTime(),
      updatedAt: challenge.updatedAt.getTime(),
      lastUsedAt: challenge.lastUsedAt?.getTime()
    };
    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: marshall(challengeForStorage, {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true
      }),
      ConditionExpression: "attribute_not_exists(id)"
    });
    try {
      await dynamoClient.send(command);
      logger.info(`Challenge created: ${challenge.id}`);
      return challenge;
    } catch (error) {
      logger.error(
        `Failed to create challenge: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Failed to create challenge: ${error}`);
    }
  }
  /**
   * Retrieve a challenge by ID.
   */
  async getChallenge(id) {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ id })
    });
    try {
      const result = await dynamoClient.send(command);
      if (!result.Item) {
        return null;
      }
      const item = unmarshall(result.Item);
      return this.convertTimestampsToDate(item);
    } catch (error) {
      logger.error(
        `Failed to get challenge ${id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Failed to get challenge: ${error}`);
    }
  }
  /**
   * List all active challenges, optionally sorted by different criteria.
   */
  async listChallenges(sortBy = "newest") {
    let indexName;
    switch (sortBy) {
      case "usage":
        indexName = "isActive-usageCount-index";
        break;
      case "lastUsed":
        indexName = "isActive-lastUsedAt-index";
        break;
      case "newest":
      default:
        indexName = "isActive-createdAt-index";
        break;
    }
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: indexName,
      KeyConditionExpression: "isActive = :isActive",
      ExpressionAttributeValues: marshall({
        ":isActive": "true"
      }),
      ScanIndexForward: sortBy === "newest" ? false : true
      // DESC for newest, ASC for others
    });
    try {
      const result = await dynamoClient.send(command);
      const challenges = result.Items?.map(
        (item) => this.convertTimestampsToDate(unmarshall(item))
      ) || [];
      logger.info(
        `Listed ${challenges.length} active challenges (sorted by ${sortBy})`
      );
      return challenges;
    } catch (error) {
      logger.error(
        `Failed to list challenges: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Failed to list challenges: ${error}`);
    }
  }
  /**
   * Update an existing challenge.
   */
  async updateChallenge(id, input) {
    const now = /* @__PURE__ */ new Date();
    const updateExpressions = [];
    const attributeNames = {};
    const attributeValues = {
      ":updatedAt": now.getTime()
    };
    if (input.name !== void 0) {
      updateExpressions.push("#name = :name");
      attributeNames["#name"] = "name";
      attributeValues[":name"] = input.name;
    }
    if (input.description !== void 0) {
      updateExpressions.push("description = :description");
      attributeValues[":description"] = input.description;
    }
    if (input.ecsConfig !== void 0) {
      updateExpressions.push("ecsConfig = :ecsConfig");
      attributeValues[":ecsConfig"] = input.ecsConfig;
    }
    if (input.files !== void 0) {
      updateExpressions.push("files = :files");
      attributeValues[":files"] = input.files;
    }
    updateExpressions.push("updatedAt = :updatedAt");
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: Object.keys(attributeNames).length > 0 ? attributeNames : void 0,
      ExpressionAttributeValues: marshall(
        {
          ...attributeValues,
          ":true": "true"
        },
        {
          removeUndefinedValues: true,
          convertClassInstanceToMap: true
        }
      ),
      ReturnValues: "ALL_NEW",
      ConditionExpression: "attribute_exists(id) AND isActive = :true"
    });
    try {
      const result = await dynamoClient.send(command);
      const updatedItem = unmarshall(result.Attributes);
      const updatedChallenge = this.convertTimestampsToDate(updatedItem);
      logger.info(`Challenge updated: ${id}`);
      return updatedChallenge;
    } catch (error) {
      logger.error(
        `Failed to update challenge ${id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Failed to update challenge: ${error}`);
    }
  }
  /**
   * Soft delete a challenge (mark as inactive).
   */
  async deleteChallenge(id) {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
      UpdateExpression: "SET isActive = :false, updatedAt = :updatedAt",
      ExpressionAttributeValues: marshall(
        {
          ":false": "false",
          ":updatedAt": Date.now(),
          // Store as timestamp
          ":true": "true"
        },
        {
          removeUndefinedValues: true,
          convertClassInstanceToMap: true
        }
      ),
      ConditionExpression: "attribute_exists(id) AND isActive = :true"
    });
    try {
      await dynamoClient.send(command);
      logger.info(`Challenge deleted (soft): ${id}`);
    } catch (error) {
      logger.error(
        `Failed to delete challenge ${id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Failed to delete challenge: ${error}`);
    }
  }
  /**
   * Increment usage count and update last used timestamp.
   */
  async incrementUsage(id) {
    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ id }),
      UpdateExpression: "SET usageCount = usageCount + :inc, lastUsedAt = :lastUsedAt, updatedAt = :updatedAt",
      ExpressionAttributeValues: marshall(
        {
          ":inc": 1,
          ":lastUsedAt": Date.now(),
          // Store as timestamp
          ":updatedAt": Date.now(),
          // Store as timestamp
          ":true": "true"
        },
        {
          removeUndefinedValues: true,
          convertClassInstanceToMap: true
        }
      ),
      ConditionExpression: "attribute_exists(id) AND isActive = :true"
    });
    try {
      await dynamoClient.send(command);
      logger.info(`Challenge usage incremented: ${id}`);
    } catch (error) {
      logger.error(
        `Failed to increment usage for challenge ${id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Failed to increment challenge usage: ${error}`);
    }
  }
};
var ECS_CONFIG_LIMITS = {
  cpu: {
    256: [512, 1024, 2048],
    // Memory options for 256 CPU
    512: [1024, 2048, 3072, 4096],
    // Memory options for 512 CPU
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    // Memory options for 1024 CPU
    2048: [
      4096,
      5120,
      6144,
      7168,
      8192,
      9216,
      10240,
      11264,
      12288,
      13312,
      14336,
      15360,
      16384
    ],
    4096: [
      8192,
      9216,
      10240,
      11264,
      12288,
      13312,
      14336,
      15360,
      16384,
      17408,
      18432,
      19456,
      20480,
      21504,
      22528,
      23552,
      24576,
      25600,
      26624,
      27648,
      28672,
      29696,
      30720
    ]
  },
  storage: { min: 20, max: 200 }
  // GB
};
var CPU_UNITS_TO_CORES = {
  256: 0.25,
  // 0.25 vCPU
  512: 0.5,
  // 0.5 vCPU
  1024: 1,
  // 1 vCPU
  2048: 2,
  // 2 vCPU
  4096: 4
  // 4 vCPU
};
function getCpuCores(cpuUnits) {
  return CPU_UNITS_TO_CORES[cpuUnits] || 0;
}
var ChallengeValidator = class {
  /**
   * Validate ECS configuration values.
   */
  static validateECSConfig(config2) {
    const errors = [];
    const validCpuValues = Object.keys(ECS_CONFIG_LIMITS.cpu).map(Number);
    if (!validCpuValues.includes(config2.cpu)) {
      errors.push(
        `Invalid CPU value: ${config2.cpu}. Valid values: ${validCpuValues.join(", ")}`
      );
    }
    if (validCpuValues.includes(config2.cpu)) {
      const validMemoryValues = ECS_CONFIG_LIMITS.cpu[config2.cpu];
      if (!validMemoryValues.includes(config2.memory)) {
        errors.push(
          `Invalid memory value: ${config2.memory} for CPU ${config2.cpu}. Valid values: ${validMemoryValues.join(", ")}`
        );
      }
    }
    if (config2.storage < ECS_CONFIG_LIMITS.storage.min || config2.storage > ECS_CONFIG_LIMITS.storage.max) {
      errors.push(
        `Storage must be between ${ECS_CONFIG_LIMITS.storage.min} and ${ECS_CONFIG_LIMITS.storage.max} GB`
      );
    }
    return errors;
  }
  /**
   * Validate challenge creation input.
   */
  static validateCreateInput(input) {
    const errors = [];
    if (!input.name || input.name.trim().length === 0) {
      errors.push("Challenge name is required");
    }
    if (!input.description || input.description.trim().length === 0) {
      errors.push("Challenge description is required");
    }
    if (!input.createdBy || input.createdBy.trim().length === 0) {
      errors.push("Creator information is required");
    }
    if (!input.files || input.files.length === 0) {
      errors.push("At least one file is required");
    }
    errors.push(...this.validateECSConfig(input.ecsConfig));
    return errors;
  }
};
var challengeService = new ChallengeService();

// src/lib/terraform.ts
var execAsync2 = promisify2(exec2);
var TerraformManager = class {
  isRunningInECS;
  awsProfile;
  awsRegion;
  domainName;
  terraformStateBucket;
  constructor() {
    this.isRunningInECS = config.aws.deploymentContext === "ecs";
    this.awsProfile = config.aws.profile || "";
    this.awsRegion = config.aws.region;
    this.domainName = config.project.domainName;
    this.terraformStateBucket = config.storage.terraformStateBucket;
  }
  /**
   * Gets the AWS CLI prefix for commands.
   * For local development, returns empty string since AWS_PROFILE env var is set.
   * For ECS, returns empty string since IAM roles are used.
   */
  getAwsCliPrefix() {
    return "";
  }
  /**
   * Fixes Terraform provider binary permissions after download.
   *
   * Terraform providers downloaded via `terraform init` may not have execute
   * permissions in containerized environments. This method ensures all provider
   * binaries are executable to prevent runtime errors.
   *
   * @param workspaceDir - Path to the Terraform workspace directory
   */
  async fixProviderPermissions(workspaceDir) {
    try {
      await execAsync2(
        `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\; 2>/dev/null || true`,
        { timeout: 1e4 }
      );
      console.log("[fixProviderPermissions] Fixed provider permissions");
    } catch (error) {
      console.log(
        "[fixProviderPermissions] Warning: Could not fix provider permissions:",
        error
      );
    }
  }
  /**
   * Processes and formats Terraform command output for streaming display.
   *
   * Cleans ANSI color codes and prefixes each line with [Terraform] for
   * clear identification in mixed log output. Preserves line structure
   * and handles empty lines appropriately.
   *
   * @param output - Raw Terraform command output
   * @param onData - Optional callback to receive formatted output
   */
  processTerraformOutput(output, onData) {
    if (!onData) return;
    const cleanOutput = output.replaceAll(/\x1b\[[0-9;]*m/g, "");
    const lines = cleanOutput.split("\n");
    lines.forEach((line, index) => {
      if (line || index === lines.length - 1 && cleanOutput.endsWith("\n")) {
        onData(
          "[Terraform] " + line + (index < lines.length - 1 || cleanOutput.endsWith("\n") ? "\n" : "")
        );
      }
    });
  }
  async execTerraformStreaming(command, cwd, onData) {
    console.log(`[execTerraformStreaming] Executing: ${command}`);
    console.log(`[execTerraformStreaming] Working directory: ${cwd}`);
    console.log(
      `[execTerraformStreaming] Deployment context: ${this.isRunningInECS ? "ECS" : "local"}`
    );
    console.log(`[execTerraformStreaming] AWS Region: ${this.awsRegion}`);
    const env = {
      ...process.env,
      AWS_REGION: this.awsRegion,
      TF_CLI_ARGS: "-no-color",
      NO_COLOR: "1",
      TF_INPUT: "false"
    };
    if (this.isRunningInECS) {
      console.log(`[execTerraformStreaming] Using ECS IAM role for credentials`);
      env.AWS_EC2_METADATA_DISABLED = "false";
    } else {
      console.log(
        `[execTerraformStreaming] Using AWS SSO profile: ${this.awsProfile}`
      );
      env.AWS_PROFILE = this.awsProfile;
      env.AWS_EC2_METADATA_DISABLED = "true";
      try {
        await execAsync2(
          `aws sts get-caller-identity --profile ${this.awsProfile}`,
          {
            timeout: 1e4
          }
        );
        console.log(
          `[execTerraformStreaming] AWS credentials validated for profile: ${this.awsProfile}`
        );
      } catch (credentialError) {
        const errorMsg = `AWS credentials not available or expired. Please run: aws sso login --profile ${this.awsProfile}`;
        console.error(`[execTerraformStreaming] ${errorMsg}`);
        console.error(
          `[execTerraformStreaming] Credential check error:`,
          credentialError instanceof Error ? credentialError.message : String(credentialError)
        );
        return {
          success: false,
          output: "",
          error: errorMsg,
          command,
          fullOutput: `Command: ${command}
Directory: ${cwd}

--- ERROR ---
${errorMsg}

Credential check failed: ${credentialError instanceof Error ? credentialError.message : String(credentialError)}

To fix this:
1. aws sso login --profile ${this.awsProfile}
2. export AWS_PROFILE=${this.awsProfile}
3. Restart the portal`
        };
      }
    }
    return new Promise((resolve) => {
      const args = command.split(" ").slice(1);
      const child = spawn("terraform", args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (data) => {
        const output = data.toString();
        stdout += output;
        this.processTerraformOutput(output, onData);
        console.log(
          `[execTerraformStreaming - Terraform STDOUT]`,
          output.trim()
        );
      });
      child.stderr?.on("data", (data) => {
        const output = data.toString();
        stderr += output;
        this.processTerraformOutput(output, onData);
        console.log(
          `[execTerraformStreaming - Terraform STDERR]`,
          output.trim()
        );
      });
      child.on("close", (code) => {
        const fullOutput = `Command: ${command}
Directory: ${cwd}

--- STDOUT ---
${stdout}

--- STDERR ---
${stderr || "(none)"}`;
        if (code === 0) {
          console.log(`[execTerraformStreaming] Success`);
          resolve({
            success: true,
            output: stdout,
            error: stderr || void 0,
            fullOutput,
            command
          });
        } else {
          console.error(
            `[execTerraformStreaming] Failed with exit code: ${code}`
          );
          resolve({
            success: false,
            output: stdout,
            error: stderr || `Process exited with code ${code}`,
            fullOutput,
            command
          });
        }
      });
      child.on("error", (error) => {
        const fullOutput = `Command: ${command}
Directory: ${cwd}

--- ERROR ---
${error.message}`;
        console.error(`[execTerraformStreaming] Process error:`, error);
        resolve({
          success: false,
          output: "",
          error: error.message,
          fullOutput,
          command
        });
      });
    });
  }
  async uploadWorkspaceToS3(interviewId, workspaceDir) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    const s3Key = `workspaces/${interviewId}/`;
    try {
      await execAsync3(
        `aws s3 sync "${workspaceDir}" "s3://${config.storage.instanceBucket}/${s3Key}"`,
        {
          env: process.env,
          timeout: 6e4
        }
      );
      console.log(`[uploadWorkspaceToS3] Uploaded workspace to S3: ${s3Key}`);
    } catch (error) {
      console.error(
        `[uploadWorkspaceToS3] Failed to upload workspace to S3:`,
        error
      );
      throw error;
    }
  }
  async downloadWorkspaceFromS3(interviewId, workspaceDir) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    const s3Key = `workspaces/${interviewId}/`;
    try {
      await execAsync3(
        `aws s3 ls "s3://${config.storage.instanceBucket}/${s3Key}"`,
        {
          env: process.env,
          timeout: 3e4
        }
      );
      await execAsync3(
        `aws s3 sync "s3://${config.storage.instanceBucket}/${s3Key}" "${workspaceDir}"`,
        {
          env: process.env,
          timeout: 6e4
        }
      );
      console.log(
        `[downloadWorkspaceFromS3] Downloaded workspace from S3: ${s3Key}`
      );
      return true;
    } catch {
      console.log(
        `[downloadWorkspaceFromS3] No existing workspace found in S3: ${s3Key}`
      );
      return false;
    }
  }
  async downloadTemplatesFromS3(workspaceDir) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    try {
      await execAsync3(
        `aws s3 sync "s3://${config.storage.instanceBucket}/terraform/" "${workspaceDir}"`,
        {
          env: process.env,
          timeout: 6e4
        }
      );
      console.log(
        `[downloadTemplatesFromS3] Downloaded templates from S3 to: ${workspaceDir}`
      );
    } catch (error) {
      console.error(
        `[downloadTemplatesFromS3] Failed to download templates from S3:`,
        error
      );
      throw error;
    }
  }
  async createWorkspace(interviewId) {
    const workspaceDir = path.join(
      "/tmp",
      "interview-workspaces",
      `workspace-${interviewId}`
    );
    await fs.mkdir(workspaceDir, { recursive: true });
    const existsInS3 = await this.downloadWorkspaceFromS3(
      interviewId,
      workspaceDir
    );
    if (!existsInS3) {
      await this.downloadTemplatesFromS3(workspaceDir);
      const mainTfPath = path.join(workspaceDir, "main.tf");
      let mainTfContent = await fs.readFile(mainTfPath, "utf-8");
      mainTfContent = mainTfContent.replace("INTERVIEW_ID_PLACEHOLDER", interviewId).replaceAll(
        "TERRAFORM_STATE_BUCKET_PLACEHOLDER",
        this.terraformStateBucket
      ).replaceAll("AWS_REGION_PLACEHOLDER", this.awsRegion).replaceAll("ENVIRONMENT_PLACEHOLDER", config.project.environment);
      await fs.writeFile(mainTfPath, mainTfContent);
      await this.uploadWorkspaceToS3(interviewId, workspaceDir);
    }
    return workspaceDir;
  }
  async createTfvarsFile(workspaceDir, instance) {
    const tfvarsContent = `
aws_region = "${this.awsRegion}"
interview_id = "${instance.id}"
candidate_name = "${instance.candidateName}"
challenge = "${instance.challenge}"
password = "${instance.password}"
welcome_text = "Welcome, ${instance.candidateName}!"
openai_api_key = "${instance.openaiApiKey}"
`.trim();
    console.log(`[createTfvarsFile] tfvarsContent: ${tfvarsContent}`);
    const tfvarsPath = path.join(workspaceDir, "terraform.tfvars");
    await fs.writeFile(tfvarsPath, tfvarsContent);
  }
  getMinimalTfvarsContentPlaceholder(interviewId) {
    return `
interview_id = "${interviewId}"
candidate_name = "unknown"
challenge = "javascript"
password = "destroy-temp-password"
aws_region = "${this.awsRegion}"
openai_admin_key = "sk-admin-cleanup-placeholder-admin-key"
openai_api_key = "cleanup-placeholder-api-key"
openai_project_name = "${config.services.openaiProjectId || "cleanup-project"}"
openai_project_id = "${config.services.openaiProjectId || "cleanup-project"}"
openai_service_account_name = "cleanup-placeholder-service-account-name"
`.trim();
  }
  /**
   * Waits for ECS service to become healthy by polling the access URL.
   *
   * This method performs HTTP health checks against the VS Code server to determine
   * when the service is ready for candidate access. It handles the transition from
   * "configuring" to "active" status by verifying service availability.
   *
   * **Health Check Process:**
   * - Polls every 10 seconds with 8-second request timeout
   * - Uses custom User-Agent for identification in logs
   * - Considers 200 OK response as healthy
   * - Streams progress updates for real-time UI feedback
   *
   * **Common Delays:**
   * ECS services may take time to become healthy due to:
   * - Container image download (if not cached)
   * - Python/Node.js dependency installation
   * - VS Code server initialization
   * - Load balancer health check stabilization
   *
   * @param accessUrl - Full URL to the VS Code service to health check
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 5 minutes)
   * @param onData - Optional callback for real-time health check progress
   * @returns Promise with success status and optional error message
   */
  async waitForServiceHealth(accessUrl, timeoutMs = 3e5, onData) {
    const streamData = (data) => {
      if (onData) onData(data);
    };
    const startTime = Date.now();
    const maxAttempts = Math.floor(timeoutMs / 1e4);
    let attempts = 0;
    streamData(`Waiting for ECS service to become healthy at ${accessUrl}...
`);
    while (attempts < maxAttempts) {
      try {
        const response = await fetch(accessUrl, {
          method: "GET",
          headers: {
            "User-Agent": "Prequel-Portal-HealthCheck/1.0"
          },
          signal: AbortSignal.timeout(8e3)
          // 8 second timeout for each request
        });
        if (response.ok) {
          const elapsed2 = Date.now() - startTime;
          streamData(
            `\u2705 ECS service is healthy! (took ${Math.round(elapsed2 / 1e3)}s)
`
          );
          return { success: true };
        } else {
          attempts++;
          const elapsed2 = Date.now() - startTime;
          streamData(
            `\u23F3 Service not ready yet (${response.status}), waiting... (${Math.round(elapsed2 / 1e3)}s elapsed)
`
          );
        }
      } catch (error) {
        attempts++;
        const elapsed2 = Date.now() - startTime;
        if (error instanceof Error && error.name === "TimeoutError") {
          streamData(
            `\u23F3 Service not responding yet, waiting... (${Math.round(
              elapsed2 / 1e3
            )}s elapsed)
`
          );
        } else {
          streamData(
            `\u23F3 Connection failed, service may still be starting... (${Math.round(
              elapsed2 / 1e3
            )}s elapsed)
`
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1e4));
    }
    const elapsed = Date.now() - startTime;
    const errorMsg = `Service health check failed after ${Math.round(
      elapsed / 1e3
    )}s. ECS service may still be installing dependencies.`;
    streamData(`\u274C ${errorMsg}
`);
    return { success: false, error: errorMsg };
  }
  /**
   * Creates a complete AWS infrastructure for a coding interview with real-time streaming.
   *
   * This is the primary method for provisioning interview infrastructure. It orchestrates
   * the complete workflow from Terraform workspace setup through infrastructure deployment
   * and health checking. The process has distinct phases that are reflected in the UI:
   *
   * **Phases:**
   * 1. **Workspace Setup**: Downloads templates, creates tfvars, initializes Terraform
   * 2. **Infrastructure Provisioning**: Runs terraform plan and apply (status: "initializing")
   * 3. **Service Health Checking**: Waits for ECS service to be ready (status: "configuring")
   * 4. **Ready**: Service passes health checks (status: "active")
   *
   * **AWS Resources Created:**
   * - ECS service with VS Code server container
   * - Application Load Balancer with subdomain routing
   * - Route53 DNS record (interview-id.domain.com)
   * - Security groups for network isolation
   * - SSM parameter for password storage
   *
   * **Callbacks:**
   * - `onData`: Receives real-time Terraform output for streaming to UI
   * - `onInfrastructureReady`: Called when AWS resources are provisioned but before health check
   *
   * @param instance - Interview configuration (ID, candidate, challenge, password)
   * @param onData - Optional callback for real-time Terraform output streaming
   * @param onInfrastructureReady - Optional callback when infrastructure is ready but service may not be healthy
   * @returns Promise with creation result including access URL and health status
   *
   * @example
   * ```typescript
   * const result = await terraformManager.createInterviewStreaming(
   *   {
   *     id: 'abc12345',
   *     candidateName: 'John Doe',
   *     challenge: 'javascript',
   *     password: 'secure123'
   *   },
   *   (output) => {
   *     // Stream real-time Terraform output to UI
   *     console.log('Terraform:', output)
   *   },
   *   (accessUrl) => {
   *     // Infrastructure is ready, updating status to "configuring"
   *     updateStatus('configuring', accessUrl)
   *   }
   * )
   *
   * if (result.success && result.healthCheckPassed) {
   *   // Interview is fully ready for candidate access
   *   console.log('Access URL:', result.accessUrl)
   * }
   * ```
   */
  async createInterviewStreaming(instance, onData, onInfrastructureReady) {
    const workspaceDir = await this.createWorkspace(instance.id);
    const executionLog = [];
    const streamData = (data) => {
      if (onData) onData(data);
    };
    try {
      await this.createTfvarsFile(workspaceDir, instance);
      executionLog.push(`Created workspace: ${workspaceDir}`);
      streamData(`Created workspace: ${workspaceDir}
`);
      executionLog.push("Initializing Terraform...");
      streamData("Initializing Terraform...\n");
      const initResult = await this.execTerraformStreaming(
        "terraform init -input=false",
        workspaceDir,
        streamData
      );
      executionLog.push(
        `Init result: ${initResult.success ? "SUCCESS" : "FAILED"}`
      );
      if (initResult.fullOutput) executionLog.push(initResult.fullOutput);
      if (initResult.success) {
        await this.fixProviderPermissions(workspaceDir);
        executionLog.push("Provider permissions fixed");
      }
      if (!initResult.success) {
        return {
          ...initResult,
          error: `Init failed: ${initResult.error}`,
          executionLog
        };
      }
      executionLog.push("Planning infrastructure changes...");
      streamData("Planning infrastructure changes...\n");
      const planResult = await this.execTerraformStreaming(
        "terraform plan -input=false -out=tfplan",
        workspaceDir,
        streamData
      );
      executionLog.push(
        `Plan result: ${planResult.success ? "SUCCESS" : "FAILED"}`
      );
      if (planResult.fullOutput) executionLog.push(planResult.fullOutput);
      if (!planResult.success) {
        return {
          ...planResult,
          error: `Plan failed: ${planResult.error}`,
          executionLog
        };
      }
      executionLog.push("Applying infrastructure changes...");
      streamData("Applying infrastructure changes...\n");
      const applyResult = await this.execTerraformStreaming(
        "terraform apply -input=false -auto-approve tfplan",
        workspaceDir,
        streamData
      );
      executionLog.push(
        `Apply result: ${applyResult.success ? "SUCCESS" : "FAILED"}`
      );
      if (applyResult.fullOutput) executionLog.push(applyResult.fullOutput);
      if (!applyResult.success) {
        return {
          ...applyResult,
          error: `Apply failed: ${applyResult.error}`,
          executionLog
        };
      }
      executionLog.push("Retrieving infrastructure outputs...");
      streamData("Retrieving infrastructure outputs...\n");
      const outputResult = await this.execTerraformStreaming(
        "terraform output -json",
        workspaceDir,
        streamData
      );
      executionLog.push(
        `Outputs result: ${outputResult.success ? "SUCCESS" : "FAILED"}`
      );
      if (outputResult.success) {
        try {
          console.log(
            "[createInterview] Raw terraform output length:",
            outputResult.output.length
          );
          console.log(
            "[createInterview] Raw terraform output (first 500 chars):",
            outputResult.output.substring(0, 500)
          );
          const outputs = JSON.parse(outputResult.output);
          const accessUrl = outputs.access_url?.value;
          executionLog.push(`Access URL: ${accessUrl || "Not found"}`);
          streamData(`Access URL: ${accessUrl || "Not found"}
`);
          if (accessUrl && onInfrastructureReady) {
            executionLog.push("\u2705 Infrastructure provisioning completed!");
            streamData("\u2705 Infrastructure provisioning completed!\n");
            onInfrastructureReady(accessUrl);
          }
          let healthCheckPassed = false;
          if (accessUrl) {
            executionLog.push("Waiting for ECS service to become healthy...");
            streamData("Waiting for ECS service to become healthy...\n");
            const healthCheck = await this.waitForServiceHealth(
              accessUrl,
              3e5,
              streamData
            );
            healthCheckPassed = healthCheck.success;
            if (healthCheck.success) {
              executionLog.push("\u2705 ECS service is healthy and ready for use!");
              streamData("\u2705 ECS service is healthy and ready for use!\n");
            } else {
              executionLog.push(`\u26A0\uFE0F Health check failed: ${healthCheck.error}`);
              streamData(`\u26A0\uFE0F Health check failed: ${healthCheck.error}
`);
              streamData(
                "Note: Interview infrastructure is created but service may need more time to start.\n"
              );
            }
          }
          try {
            await this.uploadWorkspaceToS3(instance.id, workspaceDir);
            executionLog.push("\u2705 Workspace uploaded to S3 successfully");
          } catch (s3Error) {
            const s3ErrorMsg = s3Error instanceof Error ? s3Error.message : "Unknown error";
            executionLog.push(
              `\u26A0\uFE0F Failed to upload workspace to S3: ${s3ErrorMsg}`
            );
            streamData(`\u26A0\uFE0F Failed to upload workspace to S3: ${s3ErrorMsg}
`);
          }
          return {
            success: true,
            output: applyResult.output,
            fullOutput: executionLog.join("\n\n"),
            accessUrl,
            healthCheckPassed,
            infrastructureReady: !!accessUrl,
            executionLog
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown";
          executionLog.push(`Failed to parse Terraform outputs: ${errorMsg}`);
          executionLog.push(
            `Raw output (first 500 chars): ${outputResult.output.substring(0, 500)}`
          );
          streamData(`Failed to parse Terraform outputs: ${errorMsg}
`);
          let accessUrl;
          const urlMatch = outputResult.output.match(
            /"access_url":\s*{\s*"value":\s*"([^"]+)"/
          );
          if (urlMatch) {
            accessUrl = urlMatch[1];
            executionLog.push(`Extracted URL via regex: ${accessUrl}`);
            streamData(`Extracted URL via regex: ${accessUrl}
`);
          }
          return {
            success: true,
            output: applyResult.output,
            error: "Could not parse Terraform outputs",
            executionLog,
            healthCheckPassed: false,
            infrastructureReady: false,
            accessUrl
            // Include extracted URL even on parse failure
          };
        }
      }
      return {
        ...applyResult,
        executionLog,
        healthCheckPassed: false,
        infrastructureReady: false
      };
    } catch (error) {
      const errorMsg = `Workspace creation failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      executionLog.push(errorMsg);
      streamData(errorMsg + "\n");
      return {
        success: false,
        output: "",
        error: errorMsg,
        executionLog,
        healthCheckPassed: false,
        infrastructureReady: false
      };
    }
  }
  async scaleDownECSService(interviewId, streamData) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    try {
      const serviceName = `interview-${interviewId}`;
      streamData(`Scaling down service ${serviceName} to 0...
`);
      await execAsync3(
        `${this.getAwsCliPrefix()}aws ecs update-service --cluster ${config.infrastructure.ecsCluster} --service ${serviceName} --desired-count 0 --region ${this.awsRegion}`,
        { timeout: 3e4 }
      );
      streamData(`Waiting for service tasks to stop...
`);
      await execAsync3(
        `${this.getAwsCliPrefix()}aws ecs wait services-stable --cluster ${config.infrastructure.ecsCluster} --services ${serviceName} --region ${this.awsRegion}`,
        { timeout: 12e4 }
      );
      streamData(`Service scaled down successfully
`);
    } catch (taskError) {
      streamData(`Warning: Could not scale down ECS service: ${taskError}
`);
    }
  }
  async prepareWorkspaceForDestroy(interviewId, streamData) {
    const workspaceDir = path.join(
      "/tmp",
      "interview-workspaces",
      `workspace-${interviewId}`
    );
    const existsLocally = await fs.access(workspaceDir).then(() => true).catch(() => false);
    if (!existsLocally) {
      streamData(
        `Downloading workspace from S3 for interview ${interviewId}...
`
      );
      await fs.mkdir(workspaceDir, { recursive: true });
      const downloadedFromS3 = await this.downloadWorkspaceFromS3(
        interviewId,
        workspaceDir
      );
      if (!downloadedFromS3) {
        streamData(
          `No workspace found in S3, will attempt direct resource cleanup...
`
        );
        return { workspaceDir, success: false };
      }
      streamData(`Workspace downloaded successfully
`);
    } else {
      streamData(`Using existing local workspace
`);
    }
    const tfvarsPath = path.join(workspaceDir, "terraform.tfvars");
    const tfvarsExists = await fs.access(tfvarsPath).then(() => true).catch(() => false);
    if (!tfvarsExists) {
      streamData(
        `terraform.tfvars missing, creating minimal version for destroy...
`
      );
      await fs.writeFile(
        tfvarsPath,
        this.getMinimalTfvarsContentPlaceholder(interviewId)
      );
      streamData(`Created minimal terraform.tfvars for destruction
`);
    } else {
      streamData(`Found existing terraform.tfvars file
`);
    }
    return { workspaceDir, success: true };
  }
  async performDirectResourceCleanup(interviewId, streamData) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    streamData(
      `No workspace found in S3, attempting direct resource cleanup...
`
    );
    streamData(`Cleaning up ECS service interview-${interviewId}...
`);
    await execAsync3(
      `${this.getAwsCliPrefix()}aws ecs delete-service --cluster ${config.infrastructure.ecsCluster} --service interview-${interviewId} --force --region ${this.awsRegion} || true`,
      { timeout: 3e4 }
    );
    streamData(`Cleaning up target group for interview-${interviewId}...
`);
    await execAsync3(
      `${this.getAwsCliPrefix()}aws elbv2 delete-target-group --target-group-arn $(aws elbv2 describe-target-groups --names interview-${interviewId}-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 3e4 }
    );
    streamData(`Cleaning up dedicated ALB for interview-${interviewId}...
`);
    const albName = `interview-${interviewId}-alb`.substring(0, 32);
    await execAsync3(
      `${this.getAwsCliPrefix()}aws elbv2 delete-load-balancer --load-balancer-arn $(aws elbv2 describe-load-balancers --names ${albName} --query 'LoadBalancers[0].LoadBalancerArn' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 3e4 }
    );
    streamData(
      `Cleaning up Route53 record for ${interviewId}.${this.domainName}...
`
    );
    await execAsync3(
      `${this.getAwsCliPrefix()}aws route53 list-resource-record-sets --hosted-zone-id $(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${this.domainName}.\`].Id' --output text | cut -d'/' -f3 --region ${this.awsRegion}) --query 'ResourceRecordSets[?Name==\`${interviewId}.${this.domainName}.\`]' --output json --region ${this.awsRegion} | jq -r '.[0] | if . then "{\\"Action\\": \\"DELETE\\", \\"ResourceRecordSet\\": .}" else empty end' | if read change; then aws route53 change-resource-record-sets --hosted-zone-id $(aws route53 list-hosted-zones --query 'HostedZones[?Name==\`${this.domainName}.\`].Id' --output text | cut -d'/' -f3) --change-batch "{\\"Changes\\": [$change]}" --region ${this.awsRegion}; fi || true`,
      { timeout: 3e4 }
    );
    streamData(`Cleaning up security groups for ALB and ECS...
`);
    await execAsync3(
      `${this.getAwsCliPrefix()}aws ec2 delete-security-group --group-id $(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-ecs" --query 'SecurityGroups[0].GroupId' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 3e4 }
    );
    await execAsync3(
      `${this.getAwsCliPrefix()}aws ec2 delete-security-group --group-id $(aws ec2 describe-security-groups --filters "Name=group-name,Values=interview-${interviewId}-alb" --query 'SecurityGroups[0].GroupId' --output text --region ${this.awsRegion}) --region ${this.awsRegion} || true`,
      { timeout: 3e4 }
    );
    streamData(`Cleaning up SSM parameter...
`);
    await execAsync3(
      `${this.getAwsCliPrefix()}aws ssm delete-parameter --name /${config.project.prefix}/interviews/${interviewId}/password --region ${this.awsRegion} || true`,
      { timeout: 3e4 }
    );
    streamData(`Direct resource cleanup completed
`);
    streamData(
      `Preserving S3 workspace - manual cleanup required if resources are fully destroyed
`
    );
    return {
      success: true,
      output: "Interview cleanup completed using direct resource cleanup",
      fullOutput: "Resources cleaned up directly via AWS CLI"
    };
  }
  async runTerraformDestroy(interviewId, workspaceDir, streamData) {
    streamData(`Initializing Terraform...
`);
    const initResult = await this.execTerraformStreaming(
      "terraform init -input=false -reconfigure",
      workspaceDir,
      streamData
    );
    if (initResult.success) {
      await this.fixProviderPermissions(workspaceDir);
      streamData(`Provider permissions fixed
`);
    } else {
      streamData(`Terraform init failed, attempting permission fix...
`);
      const permissionFixed = await this.attemptPermissionFixAndRetryInit(
        workspaceDir,
        streamData
      );
      if (permissionFixed.success) {
        streamData(`Init retry succeeded, proceeding with destroy...
`);
      } else {
        streamData(
          `Terraform init failed permanently, preserving workspace for manual intervention
`
        );
        throw new Error(
          `Terraform init failed: ${initResult.error}. Workspace preserved for manual cleanup.`
        );
      }
    }
    streamData(`Starting terraform destroy for interview ${interviewId}...
`);
    return await this.execTerraformStreaming(
      "terraform destroy -input=false -auto-approve -var-file=terraform.tfvars",
      workspaceDir,
      streamData
    );
  }
  async attemptPermissionFixAndRetryInit(workspaceDir, streamData) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    streamData(`Attempting to fix provider permissions...
`);
    await execAsync3(
      `find ${workspaceDir}/.terraform -name "*terraform-provider-*" -type f -exec chmod +x {} \\;`,
      { timeout: 3e4 }
    );
    streamData(`Provider permissions fixed, retrying init...
`);
    return await this.execTerraformStreaming(
      "terraform init -input=false -reconfigure",
      workspaceDir,
      streamData
    );
  }
  async cleanupWorkspaceFiles(interviewId, workspaceDir, destroyResult, streamData) {
    streamData(`Cleaning up local workspace...
`);
    await fs.rm(workspaceDir, { recursive: true, force: true });
    if (destroyResult.success) {
      streamData(`Terraform destroy succeeded, deleting workspace from S3...
`);
      await this.deleteWorkspaceFromS3(interviewId);
      streamData(`S3 workspace cleanup completed successfully
`);
    } else {
      streamData(
        `Terraform destroy failed, preserving S3 workspace for retry
`
      );
      streamData(
        `S3 workspace preserved at: s3://${config.storage.instanceBucket}/workspaces/${interviewId}/
`
      );
    }
  }
  async deleteWorkspaceFromS3(interviewId) {
    const { exec: exec3 } = await import("child_process");
    const { promisify: promisify3 } = await import("util");
    const execAsync3 = promisify3(exec3);
    const s3Key = `workspaces/${interviewId}/`;
    console.log(
      `[deleteWorkspaceFromS3] CRITICAL: Attempting to delete workspace from S3: ${s3Key}`
    );
    console.log(
      `[deleteWorkspaceFromS3] This will permanently delete interview data for: ${interviewId}`
    );
    try {
      const listResult = await execAsync3(
        `aws s3 ls "s3://${config.storage.instanceBucket}/${s3Key}"`,
        {
          env: process.env,
          timeout: 3e4
        }
      );
      if (!listResult.stdout.trim()) {
        console.log(
          `[deleteWorkspaceFromS3] Workspace ${s3Key} does not exist in S3, skipping deletion`
        );
        return;
      }
      console.log(
        `[deleteWorkspaceFromS3] Confirmed workspace exists, proceeding with deletion: ${s3Key}`
      );
      await execAsync3(
        `aws s3 rm "s3://${config.storage.instanceBucket}/${s3Key}" --recursive`,
        {
          env: process.env,
          timeout: 6e4
        }
      );
      console.log(
        `[deleteWorkspaceFromS3] SUCCESS: Deleted workspace from S3: ${s3Key}`
      );
    } catch (error) {
      console.error(
        `[deleteWorkspaceFromS3] Failed to delete workspace from S3:`,
        error
      );
    }
  }
  /**
   * Destroys interview infrastructure with comprehensive cleanup and real-time streaming.
   *
   * This method performs complete teardown of interview AWS resources using a multi-step
   * approach to handle various failure scenarios gracefully. It prioritizes successful
   * cleanup even when Terraform state is corrupted or missing.
   *
   * **Destruction Process:**
   * 1. **ECS Service Scaling**: Scale down to 0 tasks to stop running containers
   * 2. **Workspace Recovery**: Download workspace from S3 if not available locally
   * 3. **Terraform Destroy**: Run `terraform destroy` to remove all resources
   * 4. **Direct Cleanup**: If Terraform fails, use AWS CLI for manual resource removal
   * 5. **Cleanup**: Remove local workspace and S3 workspace (only on success)
   *
   * **Fallback Strategy:**
   * If Terraform workspace is missing or corrupted, the method falls back to direct
   * AWS CLI commands to clean up known resource patterns. This ensures interviews
   * can be destroyed even when Terraform state is lost.
   *
   * **Resources Cleaned:**
   * - ECS service and tasks
   * - Application Load Balancer and target groups
   * - Route53 DNS records
   * - Security groups (ALB and ECS)
   * - SSM parameters
   * - S3 workspace files (on successful destroy)
   *
   * @param interviewId - The interview ID to destroy infrastructure for
   * @param onData - Optional callback for real-time destruction output streaming
   * @param candidateName - Optional candidate name for file extraction
   * @param challenge - Optional challenge name for file extraction
   * @param saveFiles - Optional flag to save candidate files before destruction
   * @returns Promise with destruction result and any error details
   *
   * @example
   * ```typescript
   * const result = await terraformManager.destroyInterviewStreaming(
   *   'abc12345',
   *   (output) => {
   *     // Stream real-time destruction output to UI
   *     console.log('Destroy:', output)
   *   }
   * )
   *
   * if (result.success) {
   *   console.log('Interview infrastructure destroyed successfully')
   * } else {
   *   console.error('Destruction failed:', result.error)
   *   // Some manual cleanup may be required
   * }
   * ```
   */
  async destroyInterviewStreaming(interviewId, onData, candidateName, challenge, saveFiles) {
    const streamData = (data) => {
      if (onData) onData(data);
    };
    try {
      streamData(`Starting destroy for interview ${interviewId}...
`);
      let historyS3Key;
      if (saveFiles && candidateName && challenge) {
        streamData(`Extracting candidate files for ${candidateName}...
`);
        try {
          let challengeName = "Unknown Challenge";
          try {
            const challengeData = await challengeService.getChallenge(challenge);
            if (challengeData) {
              challengeName = challengeData.name;
            }
          } catch (error) {
            streamData(
              `Warning: Failed to get challenge name for ${challenge}: ${error instanceof Error ? error.message : "Unknown error"}
`
            );
          }
          const extractionResult = await fileExtractionService.extractAndUploadFiles({
            interviewId,
            candidateName,
            challengeId: challenge,
            challengeName
          });
          if (extractionResult.success && extractionResult.s3Key) {
            historyS3Key = extractionResult.s3Key;
            streamData(`Files saved to S3: ${extractionResult.s3Key}
`);
            streamData(`Total files: ${extractionResult.totalFiles || 0}
`);
            streamData(
              `Total size: ${Math.round(
                (extractionResult.totalSizeBytes || 0) / 1024
              )} KB
`
            );
          } else {
            streamData(
              `File extraction failed: ${extractionResult.error || "Unknown error"}
`
            );
            streamData(`Continuing with interview destruction...
`);
          }
        } catch (error) {
          streamData(
            `File extraction error: ${error instanceof Error ? error.message : "Unknown error"}
`
          );
          streamData(`Continuing with interview destruction...
`);
        }
      } else if (saveFiles) {
        streamData(
          `File extraction skipped: missing candidate name or challenge
`
        );
      } else {
        streamData(`File extraction skipped: disabled for this interview
`);
      }
      streamData(`Looking for running tasks for interview ${interviewId}...
`);
      await this.scaleDownECSService(interviewId, streamData);
      const { workspaceDir, success: workspaceReady } = await this.prepareWorkspaceForDestroy(interviewId, streamData);
      if (!workspaceReady) {
        const result = await this.performDirectResourceCleanup(
          interviewId,
          streamData
        );
        return { ...result, historyS3Key };
      }
      const destroyResult = await this.runTerraformDestroy(
        interviewId,
        workspaceDir,
        streamData
      );
      await this.cleanupWorkspaceFiles(
        interviewId,
        workspaceDir,
        destroyResult,
        streamData
      );
      return { ...destroyResult, historyS3Key };
    } catch (error) {
      const errorMsg = `Destroy failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      streamData(errorMsg + "\n");
      return {
        success: false,
        output: "",
        error: errorMsg
      };
    }
  }
  /**
   * Retries health check for an existing interview infrastructure.
   *
   * This method is used when interview infrastructure was created successfully
   * but the initial health check failed. It retrieves the access URL from
   * Terraform state and attempts a new health check with shorter timeout.
   *
   * **Use Cases:**
   * - Initial health check failed during creation
   * - Service was temporarily unavailable
   * - Manual retry after dependency installation
   * - Recovery from transient network issues
   *
   * @param interviewId - The interview ID to retry health check for
   * @param onData - Optional callback for real-time health check progress
   * @returns Promise with success status, error message, and access URL
   *
   * @example
   * ```typescript
   * const result = await terraformManager.retryHealthCheck(
   *   'abc12345',
   *   (output) => console.log('Health check:', output)
   * )
   *
   * if (result.success) {
   *   console.log('Service is now healthy:', result.accessUrl)
   * } else {
   *   console.error('Health check still failing:', result.error)
   * }
   * ```
   */
  async retryHealthCheck(interviewId, onData) {
    const streamData = (data) => {
      if (onData) onData(data);
    };
    try {
      const status = await this.getInterviewStatus(interviewId);
      if (!status.success || !status.outputs) {
        return {
          success: false,
          error: "Could not get interview status for health check retry"
        };
      }
      const outputs = status.outputs;
      const accessUrl = outputs.access_url?.value;
      if (!accessUrl) {
        return {
          success: false,
          error: "No access URL found for health check retry"
        };
      }
      streamData(`Retrying health check for interview ${interviewId}...
`);
      const healthCheck = await this.waitForServiceHealth(
        accessUrl,
        12e4,
        streamData
      );
      return {
        success: healthCheck.success,
        error: healthCheck.error,
        accessUrl
      };
    } catch (error) {
      return {
        success: false,
        error: `Health check retry failed: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
  async getInterviewStatus(interviewId) {
    const workspaceDir = path.join(
      "/tmp",
      "interview-workspaces",
      `workspace-${interviewId}`
    );
    try {
      const existsLocally = await fs.access(workspaceDir).then(() => true).catch(() => false);
      if (!existsLocally) {
        await fs.mkdir(workspaceDir, { recursive: true });
        const downloadedFromS3 = await this.downloadWorkspaceFromS3(
          interviewId,
          workspaceDir
        );
        if (!downloadedFromS3) {
          return {
            success: false,
            output: "",
            error: `Interview workspace not found: ${interviewId}`
          };
        }
      }
      const outputResult = await this.execTerraformStreaming(
        "terraform output -json",
        workspaceDir
      );
      if (outputResult.success) {
        try {
          const outputs = JSON.parse(outputResult.output);
          return {
            ...outputResult,
            outputs
          };
        } catch {
          return {
            ...outputResult,
            error: "Could not parse Terraform outputs"
          };
        }
      }
      return outputResult;
    } catch (error) {
      return {
        success: false,
        output: "",
        error: `Failed to get interview status: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
  async listActiveInterviews() {
    try {
      const { exec: exec3 } = await import("child_process");
      const { promisify: promisify3 } = await import("util");
      const execAsync3 = promisify3(exec3);
      console.log(
        "[listActiveInterviews] Listing active interviews from S3 workspaces..."
      );
      try {
        await execAsync3(
          `aws s3 ls s3://${config.storage.instanceBucket}/workspaces/`,
          {
            env: process.env,
            timeout: 15e3
          }
        );
      } catch {
        console.log(
          "[listActiveInterviews] Workspaces directory does not exist in S3, creating it..."
        );
        try {
          await execAsync3(
            `echo "Workspaces directory for ${config.project.prefix} interviews" | aws s3 cp - s3://${config.storage.instanceBucket}/workspaces/.directory`,
            {
              env: process.env,
              timeout: 15e3
            }
          );
          console.log(
            "[listActiveInterviews] Created workspaces directory in S3"
          );
        } catch (createError) {
          console.error(
            "[listActiveInterviews] Failed to create workspaces directory:",
            createError
          );
        }
        return [];
      }
      const { stdout } = await execAsync3(
        `aws s3 ls s3://${config.storage.instanceBucket}/workspaces/ --recursive`,
        {
          env: process.env,
          timeout: 3e4
        }
      );
      const interviewIds = /* @__PURE__ */ new Set();
      const lines = stdout.split("\n");
      for (const line of lines) {
        const match = line.match(/workspaces\/([^\/]+)\//);
        if (match && match[1] && match[1] !== ".directory") {
          interviewIds.add(match[1]);
        }
      }
      console.log(
        `[listActiveInterviews] Found ${interviewIds.size} active interviews in S3`
      );
      return Array.from(interviewIds);
    } catch (error) {
      console.error(
        "[listActiveInterviews] Failed to list workspaces from S3:",
        error
      );
      return [];
    }
  }
};
var terraformManager = new TerraformManager();

export {
  getCpuCores,
  ChallengeValidator,
  challengeService,
  terraformManager
};
//# sourceMappingURL=chunk-4VZXAOJ5.js.map