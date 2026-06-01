import {
  logger,
  operationsLogger,
  schedulerLogger
} from "./chunk-QOQWQKGY.js";
import {
  config
} from "./chunk-BJRZHASW.js";

// src/lib/operations.ts
import { v4 as uuidv4 } from "uuid";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  ScanCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
var OperationManager = class {
  dynamoClient;
  tableName;
  eventListeners = [];
  /**
   * Creates a new OperationManager instance with DynamoDB client.
   *
   * Uses centralized configuration system for AWS credentials and table names.
   * Table name is auto-generated as: {PROJECT_PREFIX}-{ENVIRONMENT}-operations
   */
  constructor() {
    this.dynamoClient = new DynamoDBClient(config.aws.getCredentials());
    this.tableName = config.database.operationsTable;
    if (typeof window === "undefined") {
      operationsLogger.debug("OperationManager initialized", {
        tableName: this.tableName,
        region: process.env.AWS_REGION || "us-east-1"
      });
    }
  }
  /**
   * Adds an event listener for operation state changes.
   * @param listener - Function to call when operations change state
   */
  addEventListener(listener) {
    this.eventListeners.push(listener);
  }
  /**
   * Removes an event listener.
   * @param listener - The listener function to remove
   */
  removeEventListener(listener) {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }
  /**
   * Emits an operation update event to all registered listeners.
   * Called automatically whenever operation state changes.
   * @param operation - The operation that changed state
   */
  emit(operation) {
    const event = {
      type: "operation_update",
      operation,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        operationsLogger.error("Error in operation event listener", {
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });
  }
  /**
   * Emits a log update event to all registered listeners.
   * Enables real-time log streaming via Server-Sent Events.
   */
  emitLogUpdate(operationId, logs) {
    const event = {
      type: "operation_logs",
      operationId,
      logs,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        operationsLogger.error("Error in operation log event listener", {
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });
  }
  /**
   * Converts a Date to Unix timestamp (seconds) for DynamoDB storage.
   * DynamoDB doesn't have native Date support, so we store as numbers.
   */
  dateToTimestamp(date) {
    return date ? Math.floor(date.getTime() / 1e3) : void 0;
  }
  /**
   * Converts Unix timestamp back to Date object.
   */
  timestampToDate(timestamp) {
    return timestamp ? new Date(timestamp * 1e3) : void 0;
  }
  /**
   * Converts Operation to DynamoDB item format.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operationToDynamoItem(operation) {
    const now = Date.now();
    const ttl = Math.floor(now / 1e3) + 24 * 60 * 60;
    return {
      id: operation.id,
      type: operation.type,
      status: operation.status,
      interviewId: operation.interviewId,
      candidateName: operation.candidateName,
      challenge: operation.challenge,
      saveFiles: operation.saveFiles,
      createdAt: this.dateToTimestamp(operation.createdAt),
      executionStartedAt: this.dateToTimestamp(operation.executionStartedAt),
      completedAt: this.dateToTimestamp(operation.completedAt),
      scheduledAt: this.dateToTimestamp(operation.scheduledAt),
      autoDestroyAt: this.dateToTimestamp(operation.autoDestroyAt),
      logs: operation.logs,
      result: operation.result,
      ttl
      // TTL for automatic cleanup
    };
  }
  /**
   * Converts DynamoDB item to Operation format.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dynamoItemToOperation(item) {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      interviewId: item.interviewId,
      candidateName: item.candidateName,
      challenge: item.challenge,
      saveFiles: item.saveFiles,
      createdAt: this.timestampToDate(item.createdAt) || /* @__PURE__ */ new Date(),
      executionStartedAt: this.timestampToDate(item.executionStartedAt),
      completedAt: this.timestampToDate(item.completedAt),
      scheduledAt: this.timestampToDate(item.scheduledAt),
      autoDestroyAt: this.timestampToDate(item.autoDestroyAt),
      logs: item.logs || [],
      result: item.result
    };
  }
  /**
   * Creates a new operation to track a background task.
   *
   * @param type - Type of operation ('create' or 'destroy')
   * @param interviewId - Interview ID this operation belongs to
   * @param candidateName - Optional candidate name for display
   * @param challenge - Optional challenge name for display
   * @param scheduledAt - Optional scheduled execution time
   * @param autoDestroyAt - Optional auto-destroy timeout
   * @returns The generated operation ID for tracking
   *
   * @example
   * ```typescript
   * // Create immediate operation
   * const opId = await operationManager.createOperation('create', 'interview-123', 'John Doe', 'javascript')
   *
   * // Create scheduled operation
   * const scheduledOpId = await operationManager.createOperation(
   *   'create', 'interview-456', 'Jane Smith', 'python',
   *   new Date('2025-01-15T10:00:00Z'),
   *   new Date('2025-01-15T11:00:00Z')
   * )
   * ```
   */
  async createOperation(type, interviewId, candidateName, challenge, scheduledAt, autoDestroyAt, saveFiles) {
    const operationId = uuidv4();
    const operation = {
      id: operationId,
      type,
      status: scheduledAt ? "scheduled" : "pending",
      interviewId,
      candidateName,
      challenge,
      saveFiles,
      createdAt: /* @__PURE__ */ new Date(),
      scheduledAt,
      autoDestroyAt,
      logs: []
    };
    const item = this.operationToDynamoItem(operation);
    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall(item, { removeUndefinedValues: true })
        })
      );
      this.emit(operation);
      return operationId;
    } catch (error) {
      operationsLogger.error("Error creating operation in DynamoDB", {
        tableName: this.tableName,
        operationId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      throw error;
    }
  }
  /**
   * Retrieves a single operation by ID.
   */
  async getOperation(operationId) {
    const response = await this.dynamoClient.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId })
      })
    );
    if (!response.Item) {
      return void 0;
    }
    const item = unmarshall(response.Item);
    return this.dynamoItemToOperation(item);
  }
  /**
   * Retrieves all operations, sorted by creation time (newest first).
   * Uses Scan operation - should be used sparingly for large datasets.
   */
  async getAllOperations() {
    const response = await this.dynamoClient.send(
      new ScanCommand({
        TableName: this.tableName
      })
    );
    const operations = (response.Items || []).map((item) => this.dynamoItemToOperation(unmarshall(item))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return operations;
  }
  /**
   * Retrieves active operations (pending + running + scheduled) using efficient GSI queries.
   * Much more efficient than getAllOperations() when you only need active operations.
   * Perfect for polling status updates and real-time monitoring.
   *
   * @returns Promise<Operation[]> - Array of active operations (pending + running + scheduled)
   */
  async getActiveOperations() {
    const [pendingOps, runningOps, scheduledOps] = await Promise.all([
      this.getOperationsByStatus("pending"),
      this.getOperationsByStatus("running"),
      this.getOperationsByStatus("scheduled")
    ]);
    const activeOperations = [
      ...pendingOps,
      ...runningOps,
      ...scheduledOps
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return activeOperations;
  }
  /**
   * Retrieves operations by status using GSI query (much more efficient than scan).
   * Uses the 'status-scheduledAt-index' GSI for efficient querying.
   *
   * @param status - The operation status to query for
   * @returns Promise<Operation[]> - Array of operations with the specified status
   */
  async getOperationsByStatus(status) {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "status-scheduledAt-index",
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: marshall({
          ":status": status
        })
      })
    );
    const operations = (response.Items || []).map((item) => this.dynamoItemToOperation(unmarshall(item))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return operations;
  }
  /**
   * Retrieves all operations for a specific interview using GSI.
   * Much more efficient than scanning all operations.
   */
  async getOperationsByInterview(interviewId) {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "interviewId-type-index",
        KeyConditionExpression: "interviewId = :interviewId",
        ExpressionAttributeValues: marshall({
          ":interviewId": interviewId
        })
      })
    );
    const operations = (response.Items || []).map((item) => this.dynamoItemToOperation(unmarshall(item))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return operations;
  }
  /**
   * Updates operation status and automatically sets execution/completion timestamps.
   */
  async updateOperationStatus(operationId, status) {
    const now = Math.floor(Date.now() / 1e3);
    let updateExpression = "SET #status = :status";
    const expressionAttributeNames = {
      "#status": "status"
    };
    const expressionAttributeValues = {
      ":status": status
    };
    if (status === "running") {
      updateExpression += ", executionStartedAt = :executionStartedAt";
      expressionAttributeValues[":executionStartedAt"] = now;
    }
    if (status === "completed" || status === "failed") {
      updateExpression += ", completedAt = :completedAt";
      expressionAttributeValues[":completedAt"] = now;
    }
    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: marshall(expressionAttributeValues, {
          removeUndefinedValues: true
        })
      })
    );
    const operation = await this.getOperation(operationId);
    if (operation) {
      this.emit(operation);
    }
  }
  /**
   * Retrieves scheduled operations that need to be executed using GSI.
   *
   * Uses the 'status-scheduledAt-index' GSI for efficient querying of operations
   * with 'scheduled' status. Much more efficient than scanning all operations.
   *
   * @returns Promise<Operation[]> - Array of scheduled operations sorted by scheduledAt
   */
  async getScheduledOperations() {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "status-scheduledAt-index",
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: marshall({
          ":status": "scheduled"
        })
      })
    );
    const operations = (response.Items || []).map((item) => this.dynamoItemToOperation(unmarshall(item))).sort(
      (a, b) => (a.scheduledAt?.getTime() || 0) - (b.scheduledAt?.getTime() || 0)
    );
    return operations;
  }
  /**
   * Retrieves operations eligible for auto-destroy using GSI and additional filtering.
   *
   * Strategy:
   * 1. Query all completed operations using 'status-autoDestroyAt-index' GSI
   * 2. Filter for create operations with auto-destroy times that have elapsed
   * 3. Check if destroy operation already exists for each interview using 'interviewId-type-index' GSI
   *
   * This approach uses efficient DynamoDB GSI queries instead of scanning all operations,
   * making it highly scalable and preventing duplicate destroy operations.
   *
   * @returns Promise<Operation[]> - Array of operations eligible for auto-destroy
   */
  async getOperationsForAutoDestroy() {
    const now = Math.floor(Date.now() / 1e3);
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "status-autoDestroyAt-index",
        KeyConditionExpression: "#status = :status AND autoDestroyAt <= :now",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: marshall({
          ":status": "completed",
          ":now": now
        })
      })
    );
    const completedOps = (response.Items || []).map((item) => this.dynamoItemToOperation(unmarshall(item))).filter(
      (op) => op.type === "create" && op.result?.success && op.autoDestroyAt && op.autoDestroyAt <= /* @__PURE__ */ new Date()
    );
    const eligibleOps = [];
    for (const op of completedOps) {
      const hasDestroy = await this.hasDestroyOperationForInterview(
        op.interviewId
      );
      if (!hasDestroy) {
        eligibleOps.push(op);
      }
    }
    return eligibleOps;
  }
  /**
   * Checks if there's already a destroy operation for a given interview using GSI.
   * Much more efficient than scanning all operations.
   */
  async hasDestroyOperationForInterview(interviewId) {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "interviewId-type-index",
        KeyConditionExpression: "interviewId = :interviewId AND #type = :type",
        ExpressionAttributeNames: {
          "#type": "type"
        },
        ExpressionAttributeValues: marshall({
          ":interviewId": interviewId,
          ":type": "destroy"
        }),
        Limit: 1
        // We only need to know if one exists
      })
    );
    return (response.Items?.length || 0) > 0;
  }
  /**
   * Adds a log entry to an operation with batching to reduce DynamoDB writes.
   */
  logBatch = /* @__PURE__ */ new Map();
  logBatchTimeout = null;
  async addOperationLog(operationId, logEntry) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const logWithTimestamp = `[${timestamp}] ${logEntry}`;
    if (!this.logBatch.has(operationId)) {
      this.logBatch.set(operationId, []);
    }
    this.logBatch.get(operationId).push(logWithTimestamp);
    if (!this.logBatchTimeout) {
      this.logBatchTimeout = setTimeout(() => {
        this.flushLogBatch();
      }, 2e3);
    }
  }
  async flushLogBatch() {
    if (this.logBatch.size === 0) return;
    const batchOperations = Array.from(this.logBatch.entries());
    this.logBatch.clear();
    this.logBatchTimeout = null;
    for (const [operationId, logs] of batchOperations) {
      try {
        await this.dynamoClient.send(
          new UpdateItemCommand({
            TableName: this.tableName,
            Key: marshall({ id: operationId }),
            UpdateExpression: "SET logs = list_append(if_not_exists(logs, :empty_list), :logs)",
            ExpressionAttributeValues: marshall({
              ":logs": logs,
              ":empty_list": []
            })
          })
        );
        this.emitLogUpdate(operationId, logs);
      } catch (error) {
        operationsLogger.error("Error flushing logs for operation", {
          operationId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }
  /**
   * Sets the final result of an operation and updates status accordingly.
   */
  async setOperationResult(operationId, result) {
    const now = Math.floor(Date.now() / 1e3);
    const status = result?.success ? "completed" : "failed";
    operationsLogger.info("Setting operation result", {
      operationId,
      status,
      success: result?.success,
      hasError: !!result?.error
    });
    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: "SET #result = :result, #status = :status, completedAt = :completedAt",
        ExpressionAttributeNames: {
          "#result": "result",
          "#status": "status"
        },
        ExpressionAttributeValues: marshall(
          {
            ":result": result,
            ":status": status,
            ":completedAt": now
          },
          { removeUndefinedValues: true }
        )
      })
    );
    operationsLogger.info("Operation result set in DynamoDB", {
      operationId,
      status
    });
    const operation = await this.getOperation(operationId);
    if (operation) {
      this.emit(operation);
    }
  }
  /**
   * Updates an operation to mark infrastructure as ready while health check is still pending.
   */
  async updateOperationInfrastructureReady(operationId, accessUrl, password) {
    const operation = await this.getOperation(operationId);
    if (!operation) return;
    const updatedResult = {
      ...operation.result,
      success: true,
      infrastructureReady: true,
      healthCheckPassed: false,
      ...accessUrl && { accessUrl },
      ...password && { password }
    };
    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: "SET #result = :result",
        ExpressionAttributeNames: {
          "#result": "result"
        },
        ExpressionAttributeValues: marshall(
          {
            ":result": updatedResult
          },
          { removeUndefinedValues: true }
        )
      })
    );
    const updatedOperation = await this.getOperation(operationId);
    if (updatedOperation) {
      this.emit(updatedOperation);
    }
  }
  /**
   * Updates credentials (URL and password) for a scheduled interview without changing operation status.
   * Used to store credentials immediately when an interview is scheduled.
   */
  async updateScheduledInterviewCredentials(operationId, accessUrl, password) {
    const operation = await this.getOperation(operationId);
    if (!operation) return;
    const updatedResult = {
      ...operation.result,
      accessUrl,
      password
    };
    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: "SET #result = :result",
        ExpressionAttributeNames: {
          "#result": "result"
        },
        ExpressionAttributeValues: marshall(
          {
            ":result": updatedResult
          },
          { removeUndefinedValues: true }
        )
      })
    );
    const updatedOperation = await this.getOperation(operationId);
    if (updatedOperation) {
      this.emit(updatedOperation);
    }
  }
  /**
   * Cancels an operation that is pending, running, or scheduled.
   */
  async cancelOperation(operationId) {
    const operation = await this.getOperation(operationId);
    if (!operation || !["pending", "running", "scheduled"].includes(operation.status)) {
      return false;
    }
    const now = Math.floor(Date.now() / 1e3);
    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ id: operationId }),
        UpdateExpression: "SET #status = :status, completedAt = :completedAt, #result = :result",
        ExpressionAttributeNames: {
          "#status": "status",
          "#result": "result"
        },
        ExpressionAttributeValues: marshall(
          {
            ":status": "cancelled",
            ":completedAt": now,
            ":result": {
              success: false,
              error: "Operation cancelled by user"
            }
          },
          { removeUndefinedValues: true }
        )
      })
    );
    await this.addOperationLog(operationId, "Operation cancelled by user");
    const updatedOperation = await this.getOperation(operationId);
    if (updatedOperation) {
      this.emit(updatedOperation);
    }
    return true;
  }
  /**
   * Cancels all scheduled operations for a specific interview.
   * Used when an interview is manually destroyed before scheduled operations execute.
   */
  async cancelScheduledOperationsForInterview(interviewId) {
    const operations = await this.getOperationsByInterview(interviewId);
    const scheduledOps = operations.filter((op) => op.status === "scheduled");
    if (scheduledOps.length === 0) {
      return 0;
    }
    const now = Math.floor(Date.now() / 1e3);
    for (const op of scheduledOps) {
      await this.dynamoClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ id: op.id }),
          UpdateExpression: "SET #status = :status, completedAt = :completedAt, #result = :result",
          ExpressionAttributeNames: {
            "#status": "status",
            "#result": "result"
          },
          ExpressionAttributeValues: marshall(
            {
              ":status": "cancelled",
              ":completedAt": now,
              ":result": {
                success: false,
                error: "Operation cancelled due to manual interview destruction"
              }
            },
            { removeUndefinedValues: true }
          )
        })
      );
      await this.addOperationLog(
        op.id,
        "Operation cancelled due to manual interview destruction"
      );
      const updatedOperation = await this.getOperation(op.id);
      if (updatedOperation) {
        this.emit(updatedOperation);
      }
    }
    return scheduledOps.length;
  }
  /**
   * Gets logs for a specific operation.
   */
  async getOperationLogs(operationId) {
    const operation = await this.getOperation(operationId);
    return operation?.logs || [];
  }
  /**
   * Cleans up old operations (not needed with DynamoDB TTL, but kept for compatibility).
   *
   * DynamoDB TTL automatically removes operations after 24 hours using the 'ttl' attribute.
   * This is more efficient than manual cleanup and requires no maintenance.
   *
   * TTL Configuration:
   * - Set on each operation during creation (24 hours from now)
   * - DynamoDB handles deletion automatically
   * - No manual intervention required
   */
  async cleanup() {
    operationsLogger.info(
      "Cleanup not needed - DynamoDB TTL handles automatic cleanup"
    );
  }
};
var operationManager = new OperationManager();
if (typeof window === "undefined") {
  import("./scheduler-WVASRK2V.js").then(() => {
    operationsLogger.info("Scheduler initialized");
  }).catch((error) => {
    operationsLogger.error("Failed to initialize scheduler", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  });
}

// src/lib/interviews.ts
import {
  DynamoDBClient as DynamoDBClient2,
  PutItemCommand as PutItemCommand2,
  GetItemCommand as GetItemCommand2,
  UpdateItemCommand as UpdateItemCommand2,
  QueryCommand as QueryCommand2,
  DeleteItemCommand
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall2, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";
var InterviewManager = class {
  dynamoClient;
  tableName;
  constructor() {
    this.dynamoClient = new DynamoDBClient2(config.aws.getCredentials());
    this.tableName = config.database.interviewsTable;
  }
  /**
   * Creates a new interview record in DynamoDB.
   */
  async createInterview(interview) {
    const now = /* @__PURE__ */ new Date();
    const fullInterview = {
      ...interview,
      createdAt: now
    };
    if (interview.status === "destroyed" || interview.status === "error") {
      fullInterview.ttl = Math.floor(
        (now.getTime() + 90 * 24 * 60 * 60 * 1e3) / 1e3
      );
    }
    try {
      await this.dynamoClient.send(
        new PutItemCommand2({
          TableName: this.tableName,
          Item: marshall2(this.interviewToDynamoItem(fullInterview), {
            removeUndefinedValues: true
          })
        })
      );
      logger.info("Interview created in DynamoDB", {
        interviewId: interview.id,
        candidateName: interview.candidateName,
        status: interview.status
      });
      return fullInterview;
    } catch (error) {
      logger.error("Failed to create interview in DynamoDB", {
        interviewId: interview.id,
        error
      });
      throw error;
    }
  }
  /**
   * Retrieves an interview by ID.
   */
  async getInterview(id) {
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand2({
          TableName: this.tableName,
          Key: marshall2({ id })
        })
      );
      if (!response.Item) {
        return null;
      }
      return this.dynamoItemToInterview(unmarshall2(response.Item));
    } catch (error) {
      logger.error("Failed to get interview from DynamoDB", {
        interviewId: id,
        error
      });
      throw error;
    }
  }
  /**
   * Updates interview status and metadata.
   */
  async updateInterviewStatus(id, status, updates = {}) {
    const now = /* @__PURE__ */ new Date();
    let updateExpression = "SET #status = :status, updatedAt = :updatedAt";
    const expressionAttributeNames = {
      "#status": "status"
    };
    const expressionAttributeValues = {
      ":status": status,
      ":updatedAt": Math.floor(now.getTime() / 1e3)
    };
    if (status === "destroyed" || status === "error") {
      updateExpression += ", completedAt = :completedAt";
      expressionAttributeValues[":completedAt"] = Math.floor(
        now.getTime() / 1e3
      );
      updateExpression += ", #ttl = :ttl";
      expressionAttributeNames["#ttl"] = "ttl";
      expressionAttributeValues[":ttl"] = Math.floor(
        (now.getTime() + 90 * 24 * 60 * 60 * 1e3) / 1e3
      );
    }
    if (status === "destroyed" && !updates.destroyedAt) {
      updateExpression += ", destroyedAt = :destroyedAt";
      expressionAttributeValues[":destroyedAt"] = Math.floor(
        now.getTime() / 1e3
      );
    }
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== void 0) {
        updateExpression += `, ${key} = :${key}`;
        expressionAttributeValues[`:${key}`] = value instanceof Date ? Math.floor(value.getTime() / 1e3) : value;
      }
    });
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand2({
          TableName: this.tableName,
          Key: marshall2({ id }),
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: marshall2(expressionAttributeValues)
        })
      );
      logger.info("Interview status updated", {
        interviewId: id,
        status,
        updates
      });
    } catch (error) {
      logger.error("Failed to update interview status", {
        interviewId: id,
        status,
        error
      });
      throw error;
    }
  }
  /**
   * Gets active interviews (not in terminal states).
   * Uses GSI for efficient querying by status.
   */
  async getActiveInterviews() {
    const activeStatuses = [
      "scheduled",
      "initializing",
      "configuring",
      "active",
      "destroying"
    ];
    const interviews = [];
    try {
      for (const status of activeStatuses) {
        const response = await this.dynamoClient.send(
          new QueryCommand2({
            TableName: this.tableName,
            IndexName: "status-createdAt-index",
            KeyConditionExpression: "#status = :status",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: marshall2({ ":status": status }),
            ScanIndexForward: false
            // Sort by createdAt descending (newest first)
          })
        );
        if (response.Items) {
          const statusInterviews = response.Items.map(
            (item) => this.dynamoItemToInterview(unmarshall2(item))
          );
          interviews.push(...statusInterviews);
        }
      }
      interviews.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return interviews;
    } catch (error) {
      logger.error("Failed to get active interviews", { error });
      throw error;
    }
  }
  /**
   * Gets historical interviews (completed or failed).
   * Uses GSI for efficient querying by status.
   */
  async getHistoricalInterviews(limit = 50) {
    const historicalStatuses = ["destroyed", "error"];
    const interviews = [];
    try {
      for (const status of historicalStatuses) {
        const response = await this.dynamoClient.send(
          new QueryCommand2({
            TableName: this.tableName,
            IndexName: "status-createdAt-index",
            KeyConditionExpression: "#status = :status",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: marshall2({ ":status": status }),
            ScanIndexForward: false,
            // Sort by createdAt descending (newest first)
            Limit: Math.ceil(limit / historicalStatuses.length)
            // Distribute limit across statuses
          })
        );
        if (response.Items) {
          const statusInterviews = response.Items.map(
            (item) => this.dynamoItemToInterview(unmarshall2(item))
          );
          interviews.push(...statusInterviews);
        }
      }
      interviews.sort((a, b) => {
        const aTime = a.completedAt?.getTime() || a.createdAt.getTime();
        const bTime = b.completedAt?.getTime() || b.createdAt.getTime();
        return bTime - aTime;
      });
      return interviews.slice(0, limit);
    } catch (error) {
      logger.error("Failed to get historical interviews", { error });
      throw error;
    }
  }
  /**
   * Searches interviews by candidate name.
   */
  async searchByCandidate(candidateName, limit = 20) {
    try {
      const response = await this.dynamoClient.send(
        new QueryCommand2({
          TableName: this.tableName,
          IndexName: "candidateName-createdAt-index",
          KeyConditionExpression: "candidateName = :candidateName",
          ExpressionAttributeValues: marshall2({
            ":candidateName": candidateName
          }),
          ScanIndexForward: false,
          // Sort by createdAt descending (newest first)
          Limit: limit
        })
      );
      if (!response.Items) {
        return [];
      }
      return response.Items.map(
        (item) => this.dynamoItemToInterview(unmarshall2(item))
      );
    } catch (error) {
      logger.error("Failed to search interviews by candidate", {
        candidateName,
        error
      });
      throw error;
    }
  }
  /**
   * Deletes an interview record (for cleanup).
   */
  async deleteInterview(id) {
    try {
      await this.dynamoClient.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall2({ id })
        })
      );
      logger.info("Interview deleted from DynamoDB", { interviewId: id });
    } catch (error) {
      logger.error("Failed to delete interview", { interviewId: id, error });
      throw error;
    }
  }
  /**
   * Converts Interview object to DynamoDB item format.
   * Converts Date objects to Unix timestamps for DynamoDB storage.
   */
  interviewToDynamoItem(interview) {
    return {
      ...interview,
      createdAt: Math.floor(interview.createdAt.getTime() / 1e3),
      scheduledAt: interview.scheduledAt ? Math.floor(interview.scheduledAt.getTime() / 1e3) : void 0,
      autoDestroyAt: interview.autoDestroyAt ? Math.floor(interview.autoDestroyAt.getTime() / 1e3) : void 0,
      completedAt: interview.completedAt ? Math.floor(interview.completedAt.getTime() / 1e3) : void 0,
      destroyedAt: interview.destroyedAt ? Math.floor(interview.destroyedAt.getTime() / 1e3) : void 0
    };
  }
  /**
   * Converts DynamoDB item to Interview object.
   * Converts Unix timestamps back to Date objects.
   */
  dynamoItemToInterview(item) {
    const dynamoItem = item;
    return {
      ...dynamoItem,
      createdAt: new Date(dynamoItem.createdAt * 1e3),
      scheduledAt: dynamoItem.scheduledAt ? new Date(dynamoItem.scheduledAt * 1e3) : void 0,
      autoDestroyAt: dynamoItem.autoDestroyAt ? new Date(dynamoItem.autoDestroyAt * 1e3) : void 0,
      completedAt: dynamoItem.completedAt ? new Date(dynamoItem.completedAt * 1e3) : void 0,
      destroyedAt: dynamoItem.destroyedAt ? new Date(dynamoItem.destroyedAt * 1e3) : void 0
    };
  }
  /**
   * High-level method to create a complete interview with infrastructure and DynamoDB tracking.
   * This orchestrates terraform operations and maintains DynamoDB as the source of truth.
   */
  async createInterviewWithInfrastructure(instance, onData, onInfrastructureReady, scheduledAt, autoDestroyAt, saveFiles, openaiServiceAccountId) {
    try {
      await this.createInterview({
        id: instance.id,
        candidateName: instance.candidateName,
        challenge: instance.challenge,
        status: "initializing",
        scheduledAt,
        autoDestroyAt,
        saveFiles,
        openaiServiceAccountId,
        openaiApiKey: instance.openaiApiKey
      });
      if (onData) {
        onData("Created interview record in DynamoDB\n");
      }
      const { terraformManager } = await import("./terraform-FH3UN6MM.js");
      const result = await terraformManager.createInterviewStreaming(
        instance,
        onData,
        async (accessUrl) => {
          await this.updateInterviewStatus(instance.id, "configuring");
          if (onInfrastructureReady) {
            onInfrastructureReady(accessUrl);
          }
        }
      );
      if (result.success) {
        await this.updateInterviewStatus(instance.id, "active", {
          accessUrl: result.accessUrl,
          password: instance.password
        });
        return {
          success: true,
          accessUrl: result.accessUrl,
          healthCheckPassed: result.healthCheckPassed,
          infrastructureReady: result.infrastructureReady,
          fullOutput: result.fullOutput
        };
      } else {
        await this.updateInterviewStatus(instance.id, "error");
        return {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput
        };
      }
    } catch (error) {
      try {
        await this.updateInterviewStatus(instance.id, "error");
      } catch (dbError) {
        logger.error("Failed to update interview status to error", {
          interviewId: instance.id,
          error: dbError
        });
      }
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: errorMsg
      };
    }
  }
  /**
   * High-level method to destroy interview infrastructure and update DynamoDB tracking.
   * This orchestrates terraform destruction and maintains DynamoDB consistency.
   */
  async destroyInterviewWithInfrastructure(interviewId, onData, candidateName, challenge, saveFiles) {
    try {
      await this.updateInterviewStatus(interviewId, "destroying");
      if (onData) {
        onData("Updated interview status to destroying in DynamoDB\n");
      }
      const { terraformManager } = await import("./terraform-FH3UN6MM.js");
      const result = await terraformManager.destroyInterviewStreaming(
        interviewId,
        onData,
        candidateName,
        challenge,
        saveFiles
      );
      if (result.success) {
        await this.updateInterviewStatus(interviewId, "destroyed", {
          historyS3Key: result.historyS3Key,
          destroyedAt: /* @__PURE__ */ new Date()
        });
        return {
          success: true,
          historyS3Key: result.historyS3Key,
          fullOutput: result.fullOutput
        };
      } else {
        await this.updateInterviewStatus(interviewId, "error");
        return {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput
        };
      }
    } catch (error) {
      try {
        await this.updateInterviewStatus(interviewId, "error");
      } catch (dbError) {
        logger.error("Failed to update interview status to error", {
          interviewId,
          error: dbError
        });
      }
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: errorMsg
      };
    }
  }
};
var interviewManager = new InterviewManager();

// src/lib/assessments.ts
import {
  DynamoDBClient as DynamoDBClient3,
  PutItemCommand as PutItemCommand3,
  GetItemCommand as GetItemCommand3,
  UpdateItemCommand as UpdateItemCommand3,
  ScanCommand as ScanCommand2
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall3 } from "@aws-sdk/util-dynamodb";
var AssessmentManager = class {
  dynamoClient;
  tableName;
  constructor() {
    this.dynamoClient = new DynamoDBClient3(config.aws.getCredentials());
    this.tableName = config.database.assessmentsTable || config.database.interviewsTable;
  }
  /**
   * Creates a new interview record.
   */
  async createInterview(interview) {
    const now = Math.floor(Date.now() / 1e3);
    const fullInterview = {
      ...interview,
      createdAt: now
    };
    try {
      await this.dynamoClient.send(
        new PutItemCommand3({
          TableName: this.tableName,
          Item: marshall3(fullInterview, { removeUndefinedValues: true })
        })
      );
      logger.info("Interview created", { interviewId: interview.id });
      return fullInterview;
    } catch (error) {
      logger.error("Failed to create interview", {
        interviewId: interview.id,
        error
      });
      throw error;
    }
  }
  /**
   * Creates a new take-home record.
   */
  async createTakeHome(takeHome) {
    const now = Math.floor(Date.now() / 1e3);
    const fullTakeHome = {
      ...takeHome,
      createdAt: now
    };
    try {
      await this.dynamoClient.send(
        new PutItemCommand3({
          TableName: this.tableName,
          Item: marshall3(fullTakeHome, { removeUndefinedValues: true })
        })
      );
      logger.info("TakeHome created", { takeHomeId: takeHome.id });
      return fullTakeHome;
    } catch (error) {
      logger.error("Failed to create take-home", {
        takeHomeId: takeHome.id,
        error
      });
      throw error;
    }
  }
  /**
   * Retrieves an assessment by ID (works for both interviews and take-homes).
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async getAssessment(id) {
    logger.debug("getAssessment called", { id });
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand3({
          TableName: this.tableName,
          Key: marshall3({ id })
        })
      );
      if (response.Item) {
        const item = unmarshall3(response.Item);
        logger.debug("Assessment found", {
          id,
          sessionType: item.sessionType
        });
        return item;
      }
      logger.warn("Assessment not found in database", { id });
      return null;
    } catch (error) {
      logger.error("Error looking up assessment", { id, error });
      return null;
    }
  }
  /**
   * Retrieves a take-home by access token.
   * Used during candidate activation flow.
   */
  async getTakeHomeByToken(token) {
    try {
      const response = await this.dynamoClient.send(
        new ScanCommand2({
          TableName: this.tableName,
          FilterExpression: "begins_with(PK, :pkPrefix) AND accessToken = :token",
          ExpressionAttributeValues: marshall3({
            ":pkPrefix": "TAKEHOME#",
            ":token": token
          })
        })
      );
      if (response.Items && response.Items.length > 0) {
        return unmarshall3(response.Items[0]);
      }
      return null;
    } catch (error) {
      logger.error("Failed to get take-home by token", { token, error });
      return null;
    }
  }
  /**
   * Updates instance status for an assessment.
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async updateInstanceStatus(id, sessionType, status) {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand3({
          TableName: this.tableName,
          Key: marshall3({ id }),
          UpdateExpression: "SET instanceStatus = :status",
          ExpressionAttributeValues: marshall3({ ":status": status })
        })
      );
      logger.info("Instance status updated", { id, sessionType, status });
    } catch (error) {
      logger.error("Failed to update instance status", {
        id,
        sessionType,
        status,
        error
      });
      throw error;
    }
  }
  /**
   * Updates session status for an assessment.
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async updateSessionStatus(id, sessionType, status) {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand3({
          TableName: this.tableName,
          Key: marshall3({ id }),
          UpdateExpression: "SET sessionStatus = :status",
          ExpressionAttributeValues: marshall3({ ":status": status })
        })
      );
      logger.info("Session status updated", { id, sessionType, status });
    } catch (error) {
      logger.error("Failed to update session status", {
        id,
        sessionType,
        status,
        error
      });
      throw error;
    }
  }
  /**
   * Updates take-home activation fields (activatedAt, autoDestroyAt, isActivated).
   * Called when candidate activates their take-home assessment.
   */
  async updateTakeHomeActivation(id, activatedAt, autoDestroyAt) {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand3({
          TableName: this.tableName,
          Key: marshall3({ id }),
          UpdateExpression: "SET activatedAt = :activatedAt, autoDestroyAt = :autoDestroyAt, isActivated = :isActivated",
          ExpressionAttributeValues: marshall3({
            ":activatedAt": activatedAt,
            ":autoDestroyAt": autoDestroyAt,
            ":isActivated": true
          })
        })
      );
      logger.info("Take-home activation fields updated", {
        id,
        activatedAt,
        autoDestroyAt
      });
    } catch (error) {
      logger.error("Failed to update take-home activation", {
        id,
        activatedAt,
        autoDestroyAt,
        error
      });
      throw error;
    }
  }
  /**
   * Updates assessment access credentials (url, password).
   * Called after infrastructure provisioning completes.
   */
  async updateAccessCredentials(id, url, password) {
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand3({
          TableName: this.tableName,
          Key: marshall3({ id }),
          UpdateExpression: "SET #url = :url, password = :password",
          ExpressionAttributeNames: {
            "#url": "url"
          },
          ExpressionAttributeValues: marshall3({
            ":url": url,
            ":password": password
          })
        })
      );
      logger.info("Access credentials updated", { id, url });
    } catch (error) {
      logger.error("Failed to update access credentials", { id, error });
      throw error;
    }
  }
  /**
   * Gets active interviews (not completed).
   */
  async getActiveInterviews() {
    return [];
  }
  /**
   * Gets available take-homes (not activated or expired).
   */
  async getAvailableTakeHomes() {
    return [];
  }
  /**
   * Lists all take-homes (for manager dashboard).
   * Returns take-homes sorted by creation date descending.
   */
  async listTakeHomes() {
    try {
      const response = await this.dynamoClient.send(
        new ScanCommand2({
          TableName: this.tableName,
          FilterExpression: "begins_with(PK, :pkPrefix)",
          ExpressionAttributeValues: marshall3({
            ":pkPrefix": "TAKEHOME#"
          })
        })
      );
      if (!response.Items || response.Items.length === 0) {
        return [];
      }
      const takeHomes = response.Items.map((item) => unmarshall3(item));
      return takeHomes.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      logger.error("Failed to list take-homes", { error });
      throw error;
    }
  }
  /**
   * Deletes a take-home record from DynamoDB.
   * Used during take-home deletion (for non-activated assessments).
   * Uses simple 'id' key since the table schema has 'id' as partition key.
   */
  async deleteTakeHome(id) {
    try {
      const { DeleteItemCommand: DeleteItemCommand3 } = await import("@aws-sdk/client-dynamodb");
      await this.dynamoClient.send(
        new DeleteItemCommand3({
          TableName: this.tableName,
          Key: marshall3({ id })
        })
      );
      logger.info("TakeHome deleted", { takeHomeId: id });
    } catch (error) {
      logger.error("Failed to delete take-home", { takeHomeId: id, error });
      throw error;
    }
  }
};
var assessmentManager = new AssessmentManager();

// src/lib/openai.ts
var OpenAIService = class {
  adminKey;
  projectId;
  baseUrl = "https://api.openai.com/v1";
  constructor() {
    this.adminKey = config.services.openaiAdminKey;
    this.projectId = config.services.openaiProjectId;
    if (!this.adminKey) {
      logger.warn("OPENAI_ADMIN_KEY not configured - OpenAI features disabled");
    }
    if (!this.projectId) {
      logger.warn("OPENAI_PROJECT_ID not configured - OpenAI features disabled");
    }
  }
  /**
   * Creates a new service account in the OpenAI project
   *
   * @param projectId - The OpenAI project ID
   * @param name - Name for the service account (e.g., "interview-abc123")
   * @returns Result with service account ID and API key
   */
  async createServiceAccount(projectId, name) {
    if (!this.adminKey) {
      return {
        success: false,
        error: "OPENAI_ADMIN_KEY not configured"
      };
    }
    try {
      logger.info(`Creating OpenAI service account: ${name}`);
      const response = await fetch(
        `${this.baseUrl}/organization/projects/${projectId}/service_accounts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.adminKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ name })
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`OpenAI API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `OpenAI API error: ${response.status}`
        };
      }
      const data = await response.json();
      logger.info(`Service account created: ${data.id}`);
      return {
        success: true,
        serviceAccountId: data.id,
        apiKey: data.api_key.value
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to create service account: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  }
  /**
   * Deletes a service account from the OpenAI project
   *
   * @param projectId - The OpenAI project ID
   * @param serviceAccountId - The service account ID to delete
   * @returns Result indicating success or failure
   */
  async deleteServiceAccount(projectId, serviceAccountId) {
    if (!this.adminKey) {
      return {
        success: false,
        error: "OPENAI_ADMIN_KEY not configured"
      };
    }
    try {
      logger.info(`Deleting OpenAI service account: ${serviceAccountId}`);
      const response = await fetch(
        `${this.baseUrl}/organization/projects/${projectId}/service_accounts/${serviceAccountId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.adminKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`OpenAI API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `OpenAI API error: ${response.status}`
        };
      }
      const data = await response.json();
      logger.info(`Service account deleted: ${data.id}`);
      return {
        success: true,
        deleted: data.deleted
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to delete service account: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  }
  /**
   * Lists all service accounts in the OpenAI project
   *
   * @param projectId - The OpenAI project ID
   * @returns Result with list of service accounts
   */
  async listServiceAccounts(projectId) {
    if (!this.adminKey) {
      return {
        success: false,
        error: "OPENAI_ADMIN_KEY not configured"
      };
    }
    try {
      logger.info("Listing OpenAI service accounts");
      const response = await fetch(
        `${this.baseUrl}/organization/projects/${projectId}/service_accounts?limit=100`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.adminKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`OpenAI API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `OpenAI API error: ${response.status}`
        };
      }
      const data = await response.json();
      logger.info(`Found ${data.data?.length || 0} service accounts`);
      return {
        success: true,
        accounts: data.data || []
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to list service accounts: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  }
};
var openaiService = new OpenAIService();

// src/lib/idGenerator.ts
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}
function generateSecureString() {
  return Math.random().toString(36).substring(2, 12);
}

// src/lib/apikeys.ts
import {
  DynamoDBClient as DynamoDBClient4,
  PutItemCommand as PutItemCommand4,
  GetItemCommand as GetItemCommand4,
  UpdateItemCommand as UpdateItemCommand4,
  QueryCommand as QueryCommand3,
  DeleteItemCommand as DeleteItemCommand2
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall4, unmarshall as unmarshall4 } from "@aws-sdk/util-dynamodb";
var ApiKeyManager = class {
  dynamoClient;
  tableName;
  constructor() {
    this.dynamoClient = new DynamoDBClient4(config.aws.getCredentials());
    this.tableName = config.database.apikeysTable;
  }
  /**
   * Creates a new API key record in DynamoDB
   * @param apiKey - API key data (id is optional, will be generated if not provided)
   */
  async createApiKey(apiKey) {
    const now = Math.floor(Date.now() / 1e3);
    const id = apiKey.id || generateId();
    const accessToken = apiKey.activationMode === "recipient" ? generateSecureString() : void 0;
    const fullApiKey = {
      ...apiKey,
      id,
      accessToken,
      createdAt: now
    };
    const ttlBase = fullApiKey.expiresAt || now;
    fullApiKey.ttl = ttlBase + 90 * 24 * 60 * 60;
    try {
      await this.dynamoClient.send(
        new PutItemCommand4({
          TableName: this.tableName,
          Item: marshall4(fullApiKey, { removeUndefinedValues: true })
        })
      );
      logger.info("API key created", { apiKeyId: id, name: apiKey.name });
      return fullApiKey;
    } catch (error) {
      logger.error("Failed to create API key", { error });
      throw error;
    }
  }
  /**
   * Retrieves an API key by ID
   */
  async getApiKey(id) {
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand4({
          TableName: this.tableName,
          Key: marshall4({ id })
        })
      );
      if (!response.Item) {
        return null;
      }
      return unmarshall4(response.Item);
    } catch (error) {
      logger.error("Failed to get API key", { id, error });
      throw error;
    }
  }
  /**
   * Retrieves an API key by access token (for candidate page)
   */
  async getApiKeyByToken(token) {
    try {
      const response = await this.dynamoClient.send(
        new QueryCommand3({
          TableName: this.tableName,
          IndexName: "accessToken-index",
          KeyConditionExpression: "accessToken = :token",
          ExpressionAttributeValues: marshall4({ ":token": token })
        })
      );
      if (!response.Items || response.Items.length === 0) {
        return null;
      }
      return unmarshall4(response.Items[0]);
    } catch (error) {
      logger.error("Failed to get API key by token", { error });
      throw error;
    }
  }
  /**
   * Updates API key status
   */
  async updateStatus(id, status, updates = {}) {
    const now = Math.floor(Date.now() / 1e3);
    let updateExpression = "SET #status = :status, updatedAt = :updatedAt";
    const expressionAttributeNames = {
      "#status": "status"
    };
    const expressionAttributeValues = {
      ":status": status,
      ":updatedAt": now
    };
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== void 0) {
        updateExpression += `, ${key} = :${key}`;
        expressionAttributeValues[`:${key}`] = value;
      }
    });
    if (updates.expiresAt) {
      updateExpression += ", #ttl = :ttl";
      expressionAttributeNames["#ttl"] = "ttl";
      expressionAttributeValues[":ttl"] = updates.expiresAt + 90 * 24 * 60 * 60;
    }
    try {
      await this.dynamoClient.send(
        new UpdateItemCommand4({
          TableName: this.tableName,
          Key: marshall4({ id }),
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: marshall4(expressionAttributeValues)
        })
      );
      logger.info("API key status updated", { id, status });
    } catch (error) {
      logger.error("Failed to update API key status", { id, status, error });
      throw error;
    }
  }
  /**
   * Gets all API keys by status
   */
  async getKeysByStatus(statuses) {
    const keys = [];
    try {
      for (const status of statuses) {
        const response = await this.dynamoClient.send(
          new QueryCommand3({
            TableName: this.tableName,
            IndexName: "status-createdAt-index",
            KeyConditionExpression: "#status = :status",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: marshall4({ ":status": status }),
            ScanIndexForward: false
          })
        );
        if (response.Items) {
          keys.push(...response.Items.map((item) => unmarshall4(item)));
        }
      }
      return keys.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      logger.error("Failed to get API keys by status", { statuses, error });
      throw error;
    }
  }
  /**
   * Gets all active API keys (scheduled, available, active)
   */
  async getActiveKeys() {
    return this.getKeysByStatus(["scheduled", "available", "active"]);
  }
  /**
   * Gets all historical API keys (expired, revoked, error)
   */
  async getHistoricalKeys() {
    return this.getKeysByStatus(["expired", "revoked", "error"]);
  }
  /**
   * Gets keys that need to be processed by scheduler
   */
  async getScheduledKeys() {
    return this.getKeysByStatus(["scheduled"]);
  }
  /**
   * Gets active keys that have expired
   */
  async getExpiredActiveKeys() {
    const now = Math.floor(Date.now() / 1e3);
    const activeKeys = await this.getKeysByStatus(["active"]);
    return activeKeys.filter((key) => key.expiresAt && key.expiresAt <= now);
  }
  /**
   * Gets available keys that are past their availability window
   */
  async getExpiredAvailableKeys() {
    const now = Math.floor(Date.now() / 1e3);
    const availableKeys = await this.getKeysByStatus(["available"]);
    return availableKeys.filter(
      (key) => key.availableUntil && key.availableUntil <= now
    );
  }
  /**
   * Deletes an API key record
   */
  async deleteApiKey(id) {
    try {
      await this.dynamoClient.send(
        new DeleteItemCommand2({
          TableName: this.tableName,
          Key: marshall4({ id })
        })
      );
      logger.info("API key deleted", { id });
    } catch (error) {
      logger.error("Failed to delete API key", { id, error });
      throw error;
    }
  }
};
var apiKeyManager = new ApiKeyManager();

// src/lib/scheduler.ts
var SchedulerService = class {
  checkInterval = null;
  constructor() {
    this.start();
  }
  /**
   * Starts the scheduler service with 30-second polling interval.
   * Automatically called in constructor.
   */
  start() {
    if (process.env.NODE_ENV === "test" || process.env.DISABLE_SCHEDULER === "true") {
      return;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.checkInterval = setInterval(() => {
      this.processScheduledOperations();
      this.processAutoDestroyOperations();
      this.processTakeHomes();
      this.processApiKeys();
    }, 3e4);
    schedulerLogger.info("Scheduler service started");
  }
  /**
   * Stops the scheduler service and clears the polling interval.
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    schedulerLogger.info("Scheduler service stopped");
  }
  /**
   * No-op emit method. Events are logged but not broadcast.
   * Kept for code documentation purposes.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  emit(_event) {
  }
  /**
   * Processes operations scheduled to start at or before the current time.
   * Called every 30 seconds to check for due operations.
   *
   * **Pre-provisioning Strategy:**
   * Starts provisioning 5 minutes before the scheduled time to ensure the
   * instance is active and ready exactly at the scheduled time.
   *
   * Timeline example:
   * - Scheduled time: 2:00 PM
   * - Provisioning starts: 1:55 PM (5 minutes early)
   * - Instance active: ~1:58-2:00 PM (ready at scheduled time)
   *
   * Uses DynamoDB GSI to efficiently query operations with 'scheduled' status.
   */
  async processScheduledOperations() {
    try {
      const scheduledOps = await operationManager.getScheduledOperations();
      const now = /* @__PURE__ */ new Date();
      if (scheduledOps.length > 0) {
        schedulerLogger.debug(
          `Found ${scheduledOps.length} scheduled operations to check`
        );
      }
      for (const operation of scheduledOps) {
        if (operation.scheduledAt) {
          const provisioningTime = new Date(
            operation.scheduledAt.getTime() - 5 * 60 * 1e3
          );
          if (provisioningTime <= now) {
            schedulerLogger.info("Processing scheduled operation", {
              operationId: operation.id,
              interviewId: operation.interviewId,
              type: operation.type,
              candidateName: operation.candidateName,
              scheduledAt: operation.scheduledAt.toISOString(),
              provisioningStartTime: provisioningTime.toISOString(),
              minutesBeforeScheduled: Math.round(
                (operation.scheduledAt.getTime() - now.getTime()) / 6e4
              )
            });
            try {
              if (operation.type === "create" && operation.candidateName && operation.challenge) {
                await this.executeScheduledCreate({
                  id: operation.id,
                  interviewId: operation.interviewId,
                  candidateName: operation.candidateName,
                  challenge: operation.challenge
                });
              } else if (operation.type === "destroy") {
                await this.executeScheduledDestroy({
                  id: operation.id,
                  interviewId: operation.interviewId,
                  candidateName: operation.candidateName,
                  challenge: operation.challenge,
                  saveFiles: operation.saveFiles
                });
              }
            } catch (error) {
              schedulerLogger.error("Error processing scheduled operation", {
                operationId: operation.id,
                interviewId: operation.interviewId,
                error: error instanceof Error ? error.message : "Unknown error"
              });
              await operationManager.addOperationLog(
                operation.id,
                `\u274C Scheduler error: ${error instanceof Error ? error.message : "Unknown error"}`
              );
              await operationManager.updateOperationStatus(
                operation.id,
                "failed"
              );
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "ThrottlingException") {
        schedulerLogger.warn(
          "DynamoDB throttling during scheduled operations check - will retry next cycle"
        );
      } else {
        schedulerLogger.error("Error in processScheduledOperations", {
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }
  /**
   * Processes interviews that have reached their auto-destroy timeout.
   * Creates destroy operations for expired interviews to prevent resource waste.
   * Called every 30 seconds to check for expired interviews.
   *
   * **Dual-source Auto-destroy Strategy:**
   * 1. Check operations table for operations-based auto-destroy (legacy)
   * 2. Check DynamoDB interviews table for interview-based auto-destroy (new)
   *
   * This ensures comprehensive coverage during the transition period and prevents
   * resource leaks from either source.
   */
  async processAutoDestroyOperations() {
    try {
      await this.processOperationsAutoDestroy();
      await this.processInterviewsAutoDestroy();
    } catch (error) {
      if (error instanceof Error && error.name === "ThrottlingException") {
        schedulerLogger.warn(
          "DynamoDB throttling during auto-destroy check - will retry next cycle"
        );
      } else {
        schedulerLogger.error("Error in processAutoDestroyOperations", {
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }
  /**
   * Processes operations-based auto-destroy (legacy approach).
   * Looks for completed create operations that have reached their auto-destroy timeout.
   */
  async processOperationsAutoDestroy() {
    try {
      const autoDestroyOps = await operationManager.getOperationsForAutoDestroy();
      if (autoDestroyOps.length > 0) {
        schedulerLogger.debug(
          `Found ${autoDestroyOps.length} operations eligible for auto-destroy`
        );
      }
      for (const operation of autoDestroyOps) {
        schedulerLogger.info("Auto-destroying interview (via operations)", {
          interviewId: operation.interviewId,
          operationId: operation.id,
          candidateName: operation.candidateName,
          autoDestroyAt: operation.autoDestroyAt?.toISOString()
        });
        try {
          const destroyOpId = await operationManager.createOperation(
            "destroy",
            operation.interviewId,
            operation.candidateName,
            operation.challenge,
            void 0,
            // scheduledAt
            void 0,
            // autoDestroyAt
            operation.saveFiles
            // Inherit saveFiles setting from original operation
          );
          const destroyOp = await operationManager.getOperation(destroyOpId);
          if (destroyOp) {
            await this.executeScheduledDestroy({
              id: destroyOp.id,
              interviewId: destroyOp.interviewId,
              candidateName: destroyOp.candidateName,
              challenge: destroyOp.challenge,
              saveFiles: destroyOp.saveFiles
            });
          }
          this.emit({
            type: "auto_destroy_triggered",
            operationId: destroyOpId,
            interviewId: operation.interviewId,
            originalOperationId: operation.id
          });
        } catch (error) {
          schedulerLogger.error(
            "Error auto-destroying interview (operations)",
            {
              interviewId: operation.interviewId,
              operationId: operation.id,
              error: error instanceof Error ? error.message : "Unknown error"
            }
          );
        }
      }
    } catch (error) {
      schedulerLogger.error("Error in processOperationsAutoDestroy", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Processes DynamoDB interviews auto-destroy (new approach).
   * Looks for active interviews that have reached their auto-destroy timeout.
   */
  async processInterviewsAutoDestroy() {
    try {
      const activeInterviews = await interviewManager.getActiveInterviews();
      const now = /* @__PURE__ */ new Date();
      const expiredInterviews = activeInterviews.filter(
        (interview) => interview.autoDestroyAt && interview.autoDestroyAt <= now && interview.status === "active"
        // Only destroy active interviews
      );
      if (expiredInterviews.length > 0) {
        schedulerLogger.debug(
          `Found ${expiredInterviews.length} interviews eligible for auto-destroy from DynamoDB`
        );
      }
      for (const interview of expiredInterviews) {
        const operations = await operationManager.getOperationsByInterview(
          interview.id
        );
        const hasActiveDestroy = operations.some(
          (op) => op.type === "destroy" && (op.status === "pending" || op.status === "running")
        );
        if (hasActiveDestroy) {
          schedulerLogger.debug(
            "Skipping auto-destroy - destroy already in progress",
            {
              interviewId: interview.id,
              candidateName: interview.candidateName
            }
          );
          continue;
        }
        schedulerLogger.info("Auto-destroying interview (via DynamoDB)", {
          interviewId: interview.id,
          candidateName: interview.candidateName,
          autoDestroyAt: interview.autoDestroyAt?.toISOString()
        });
        try {
          const destroyOpId = await operationManager.createOperation(
            "destroy",
            interview.id,
            interview.candidateName,
            interview.challenge,
            void 0,
            // scheduledAt
            void 0,
            // autoDestroyAt
            interview.saveFiles
            // Use saveFiles setting from interview record
          );
          const destroyOp = await operationManager.getOperation(destroyOpId);
          if (destroyOp) {
            await this.executeScheduledDestroy({
              id: destroyOp.id,
              interviewId: destroyOp.interviewId,
              candidateName: destroyOp.candidateName,
              challenge: destroyOp.challenge,
              saveFiles: destroyOp.saveFiles
            });
          }
          this.emit({
            type: "auto_destroy_triggered",
            operationId: destroyOpId,
            interviewId: interview.id,
            originalOperationId: void 0
            // No original operation for DynamoDB-based auto-destroy
          });
        } catch (error) {
          schedulerLogger.error("Error auto-destroying interview (DynamoDB)", {
            interviewId: interview.id,
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    } catch (error) {
      schedulerLogger.error("Error in processInterviewsAutoDestroy", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Combined processing of take-homes: expiration and auto-destroy.
   * Uses a single DynamoDB query for efficiency.
   * Called every 30 seconds as part of the scheduler tick.
   */
  async processTakeHomes() {
    try {
      const takeHomes = await assessmentManager.listTakeHomes();
      if (takeHomes.length === 0) {
        return;
      }
      const now = Math.floor(Date.now() / 1e3);
      for (const takeHome of takeHomes) {
        if (takeHome.sessionStatus === "available" && takeHome.availableUntil <= now) {
          await this.expireTakeHome(takeHome);
          continue;
        }
        if (takeHome.sessionStatus === "activated" && takeHome.instanceStatus === "active" && takeHome.autoDestroyAt && takeHome.autoDestroyAt <= now) {
          await this.autoDestroyTakeHome(takeHome);
        }
      }
    } catch (error) {
      schedulerLogger.error("Error in processTakeHomes", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Expires a single take-home and cleans up its OpenAI service account.
   */
  async expireTakeHome(takeHome) {
    schedulerLogger.info("Expiring take-home", {
      takeHomeId: takeHome.id,
      availableUntil: new Date(takeHome.availableUntil * 1e3).toISOString()
    });
    try {
      if (takeHome.openaiServiceAccount?.serviceAccountId) {
        schedulerLogger.info("Deleting OpenAI service account", {
          serviceAccountId: takeHome.openaiServiceAccount.serviceAccountId
        });
        const deleteResult = await openaiService.deleteServiceAccount(
          config.services.openaiProjectId,
          takeHome.openaiServiceAccount.serviceAccountId
        );
        if (deleteResult.success) {
          schedulerLogger.info("OpenAI service account deleted", {
            serviceAccountId: takeHome.openaiServiceAccount.serviceAccountId
          });
        } else {
          schedulerLogger.error("OpenAI service account deletion failed", {
            serviceAccountId: takeHome.openaiServiceAccount.serviceAccountId,
            error: deleteResult.error
          });
        }
      }
      await assessmentManager.updateSessionStatus(
        takeHome.id,
        "takehome",
        "expired"
      );
      schedulerLogger.info("Take-home marked as expired", {
        takeHomeId: takeHome.id
      });
    } catch (error) {
      schedulerLogger.error("Error expiring take-home", {
        takeHomeId: takeHome.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Auto-destroys an activated take-home that has reached its timeout.
   */
  async autoDestroyTakeHome(takeHome) {
    const operations = await operationManager.getOperationsByInterview(
      takeHome.id
    );
    const hasActiveDestroy = operations.some(
      (op) => (op.type === "destroy" || op.type === "revoke_takehome") && (op.status === "pending" || op.status === "running")
    );
    if (hasActiveDestroy) {
      schedulerLogger.debug("Skipping auto-destroy - already in progress", {
        takeHomeId: takeHome.id
      });
      return;
    }
    schedulerLogger.info("Auto-destroying activated take-home", {
      takeHomeId: takeHome.id,
      candidateName: takeHome.candidateName,
      autoDestroyAt: takeHome.autoDestroyAt ? new Date(takeHome.autoDestroyAt * 1e3).toISOString() : "unknown"
    });
    try {
      await assessmentManager.updateSessionStatus(
        takeHome.id,
        "takehome",
        "completed"
      );
      await assessmentManager.updateInstanceStatus(
        takeHome.id,
        "takehome",
        "destroying"
      );
      const destroyOpId = await operationManager.createOperation(
        "destroy",
        takeHome.id,
        takeHome.candidateName,
        takeHome.challengeId,
        void 0,
        void 0,
        takeHome.saveFiles || true
      );
      const destroyOp = await operationManager.getOperation(destroyOpId);
      if (destroyOp) {
        await this.executeScheduledDestroy({
          id: destroyOp.id,
          interviewId: destroyOp.interviewId,
          candidateName: destroyOp.candidateName,
          challenge: destroyOp.challenge,
          saveFiles: destroyOp.saveFiles
        });
      }
    } catch (error) {
      schedulerLogger.error("Error auto-destroying activated take-home", {
        takeHomeId: takeHome.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Processes API keys: scheduled activation and expiration.
   * Called every 30 seconds as part of the scheduler tick.
   */
  async processApiKeys() {
    try {
      await this.processScheduledApiKeys();
      await this.processExpiredApiKeys();
      await this.processExpiredAvailableApiKeys();
    } catch (error) {
      schedulerLogger.error("Error in processApiKeys", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Processes scheduled API keys that are due for activation.
   */
  async processScheduledApiKeys() {
    try {
      const scheduledKeys = await apiKeyManager.getScheduledKeys();
      const now = Math.floor(Date.now() / 1e3);
      for (const key of scheduledKeys) {
        if (key.scheduledAt && key.scheduledAt <= now) {
          schedulerLogger.info("Activating scheduled API key", {
            apiKeyId: key.id,
            name: key.name
          });
          try {
            if (config.services.openaiProjectId && config.services.openaiAdminKey) {
              const result = await openaiService.createServiceAccount(
                config.services.openaiProjectId,
                `interview-${config.project.environment}-apikey-${key.id}-${key.name}`
              );
              if (result.success) {
                const expiresAt = now + key.durationSeconds;
                await apiKeyManager.updateStatus(key.id, "active", {
                  activatedAt: now,
                  expiresAt,
                  serviceAccountId: result.serviceAccountId,
                  apiKey: result.apiKey
                });
                schedulerLogger.info("Scheduled API key activated", {
                  apiKeyId: key.id
                });
              } else {
                await apiKeyManager.updateStatus(key.id, "error");
                schedulerLogger.error("Failed to activate scheduled API key", {
                  apiKeyId: key.id,
                  error: result.error
                });
              }
            } else {
              await apiKeyManager.updateStatus(key.id, "error");
              schedulerLogger.error(
                "Cannot activate scheduled API key - OpenAI not configured",
                {
                  apiKeyId: key.id
                }
              );
            }
          } catch (error) {
            await apiKeyManager.updateStatus(key.id, "error");
            schedulerLogger.error("Error activating scheduled API key", {
              apiKeyId: key.id,
              error: error instanceof Error ? error.message : "Unknown error"
            });
          }
        }
      }
    } catch (error) {
      schedulerLogger.error("Error in processScheduledApiKeys", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Processes active API keys that have expired.
   */
  async processExpiredApiKeys() {
    try {
      const expiredKeys = await apiKeyManager.getExpiredActiveKeys();
      const now = Math.floor(Date.now() / 1e3);
      for (const key of expiredKeys) {
        schedulerLogger.info("Expiring API key", {
          apiKeyId: key.id,
          name: key.name
        });
        try {
          if (key.serviceAccountId && config.services.openaiProjectId) {
            const result = await openaiService.deleteServiceAccount(
              config.services.openaiProjectId,
              key.serviceAccountId
            );
            if (!result.success) {
              schedulerLogger.warn("Failed to delete OpenAI service account", {
                apiKeyId: key.id,
                serviceAccountId: key.serviceAccountId,
                error: result.error
              });
            }
          }
          await apiKeyManager.updateStatus(key.id, "expired", {
            expiredAt: now
          });
          schedulerLogger.info("API key expired", { apiKeyId: key.id });
        } catch (error) {
          schedulerLogger.error("Error expiring API key", {
            apiKeyId: key.id,
            error: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }
    } catch (error) {
      schedulerLogger.error("Error in processExpiredApiKeys", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  /**
   * Processes available API keys that are past their availability window.
   */
  async processExpiredAvailableApiKeys() {
    try {
      const expiredKeys = await apiKeyManager.getExpiredAvailableKeys();
      const now = Math.floor(Date.now() / 1e3);
      for (const key of expiredKeys) {
        schedulerLogger.info("Expiring available API key", {
          apiKeyId: key.id,
          name: key.name
        });
        await apiKeyManager.updateStatus(key.id, "expired", { expiredAt: now });
        schedulerLogger.info("Available API key expired", { apiKeyId: key.id });
      }
    } catch (error) {
      schedulerLogger.error("Error in processExpiredAvailableApiKeys", {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  async executeScheduledCreate(operation) {
    await operationManager.updateOperationStatus(operation.id, "running");
    await operationManager.addOperationLog(
      operation.id,
      `\u{1F550} Scheduled interview creation starting for ${operation.candidateName}`
    );
    this.emit({
      type: "scheduled_create_started",
      operationId: operation.id,
      interviewId: operation.interviewId
    });
    let serviceAccountId;
    let openaiApiKey;
    if (config.services.openaiProjectId && config.services.openaiAdminKey) {
      await operationManager.addOperationLog(
        operation.id,
        "\u{1F916} Creating OpenAI service account..."
      );
      const serviceAccountResult = await openaiService.createServiceAccount(
        config.services.openaiProjectId,
        `interview-${config.project.environment}-interview-${operation.interviewId}-${operation.candidateName}`
      );
      if (serviceAccountResult.success) {
        serviceAccountId = serviceAccountResult.serviceAccountId;
        openaiApiKey = serviceAccountResult.apiKey;
        await operationManager.addOperationLog(
          operation.id,
          `\u2705 OpenAI service account created: ${serviceAccountId}`
        );
      } else {
        await operationManager.addOperationLog(
          operation.id,
          `\u274C OpenAI service account creation failed: ${serviceAccountResult.error}`
        );
        await operationManager.setOperationResult(operation.id, {
          success: false,
          error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`
        });
        this.emit({
          type: "scheduled_create_completed",
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: false,
          error: `Failed to create OpenAI service account: ${serviceAccountResult.error}`
        });
        return;
      }
    }
    const instance = {
      id: operation.interviewId,
      candidateName: operation.candidateName,
      challenge: operation.challenge,
      password: generateSecureString(),
      openaiApiKey
    };
    try {
      const operationDetails = await operationManager.getOperation(operation.id);
      const result = await interviewManager.createInterviewWithInfrastructure(
        instance,
        (data) => {
          const lines = data.split("\n").filter((line) => line.trim());
          lines.forEach((line) => {
            operationManager.addOperationLog(operation.id, line).catch(console.error);
          });
        },
        (accessUrl) => {
          operationManager.updateOperationInfrastructureReady(
            operation.id,
            accessUrl,
            instance.password
          ).catch(console.error);
        },
        operationDetails?.scheduledAt,
        operationDetails?.autoDestroyAt,
        operationDetails?.saveFiles,
        serviceAccountId
      );
      if (result.success) {
        await operationManager.addOperationLog(
          operation.id,
          "\u2705 Scheduled interview created successfully!"
        );
        await operationManager.addOperationLog(
          operation.id,
          `Access URL: ${result.accessUrl}`
        );
        await operationManager.setOperationResult(operation.id, {
          success: true,
          accessUrl: result.accessUrl,
          password: instance.password,
          fullOutput: result.fullOutput,
          healthCheckPassed: result.healthCheckPassed
        });
        this.emit({
          type: "scheduled_create_completed",
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: true,
          accessUrl: result.accessUrl
        });
      } else {
        await operationManager.addOperationLog(
          operation.id,
          "\u274C Scheduled interview creation failed"
        );
        await operationManager.addOperationLog(
          operation.id,
          `Error: ${result.error}`
        );
        await operationManager.setOperationResult(operation.id, {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput
        });
        this.emit({
          type: "scheduled_create_completed",
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await operationManager.addOperationLog(
        operation.id,
        `\u274C Error: ${errorMsg}`
      );
      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: errorMsg
      });
      this.emit({
        type: "scheduled_create_completed",
        operationId: operation.id,
        interviewId: operation.interviewId,
        success: false,
        error: errorMsg
      });
    }
  }
  async executeScheduledDestroy(operation) {
    await operationManager.updateOperationStatus(operation.id, "running");
    await operationManager.addOperationLog(
      operation.id,
      `\u{1F550} Scheduled interview destruction starting for ${operation.candidateName || operation.interviewId}`
    );
    this.emit({
      type: "scheduled_destroy_started",
      operationId: operation.id,
      interviewId: operation.interviewId
    });
    try {
      let interview = null;
      try {
        interview = await interviewManager.getInterview(operation.interviewId);
      } catch (error) {
        schedulerLogger.debug(
          "Could not fetch interview record for OpenAI cleanup",
          {
            interviewId: operation.interviewId,
            error: error instanceof Error ? error.message : "Unknown error"
          }
        );
      }
      if (interview?.openaiServiceAccountId) {
        await operationManager.addOperationLog(
          operation.id,
          "\u{1F916} Deleting OpenAI service account..."
        );
        const deleteResult = await openaiService.deleteServiceAccount(
          config.services.openaiProjectId,
          interview?.openaiServiceAccountId
        );
        if (deleteResult.success) {
          await operationManager.addOperationLog(
            operation.id,
            `\u2705 OpenAI service account deleted: ${interview?.openaiServiceAccountId}`
          );
        } else {
          await operationManager.addOperationLog(
            operation.id,
            `\u26A0\uFE0F OpenAI service account deletion failed: ${deleteResult.error}`
          );
        }
      }
      const result = await interviewManager.destroyInterviewWithInfrastructure(
        operation.interviewId,
        (data) => {
          const lines = data.split("\n").filter((line) => line.trim());
          lines.forEach((line) => {
            operationManager.addOperationLog(operation.id, line).catch(console.error);
          });
        },
        operation.candidateName,
        operation.challenge,
        operation.saveFiles
      );
      if (result.success) {
        await operationManager.addOperationLog(
          operation.id,
          "\u2705 Infrastructure destroyed successfully"
        );
        await operationManager.addOperationLog(
          operation.id,
          "\u2705 Scheduled interview destroyed successfully!"
        );
        await operationManager.setOperationResult(operation.id, {
          success: true,
          historyS3Key: result.historyS3Key,
          fullOutput: result.fullOutput
        });
        this.emit({
          type: "scheduled_destroy_completed",
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: true
        });
      } else {
        await operationManager.addOperationLog(
          operation.id,
          "\u274C Scheduled interview destruction failed"
        );
        await operationManager.addOperationLog(
          operation.id,
          `Error: ${result.error}`
        );
        await operationManager.setOperationResult(operation.id, {
          success: false,
          error: result.error,
          fullOutput: result.fullOutput
        });
        this.emit({
          type: "scheduled_destroy_completed",
          operationId: operation.id,
          interviewId: operation.interviewId,
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await operationManager.addOperationLog(
        operation.id,
        `\u274C Error: ${errorMsg}`
      );
      await operationManager.setOperationResult(operation.id, {
        success: false,
        error: errorMsg
      });
      this.emit({
        type: "scheduled_destroy_completed",
        operationId: operation.id,
        interviewId: operation.interviewId,
        success: false,
        error: errorMsg
      });
    }
  }
};
var scheduler = new SchedulerService();

export {
  interviewManager,
  generateId,
  generateSecureString,
  apiKeyManager,
  openaiService,
  assessmentManager,
  SchedulerService,
  scheduler,
  operationManager
};
//# sourceMappingURL=chunk-4AJFIXKU.js.map