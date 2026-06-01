import type { Operation } from './types/operation'

/**
 * Pure helpers for converting between Operation objects and DynamoDB items.
 *
 * These functions contain no instance state and are extracted from
 * OperationManager so they can be tested and reused independently.
 */

/**
 * Converts a Date to Unix timestamp (seconds) for DynamoDB storage.
 * DynamoDB doesn't have native Date support, so we store as numbers.
 */
export function dateToTimestamp(date?: Date): number | undefined {
  return date ? Math.floor(date.getTime() / 1000) : undefined
}

/**
 * Converts Unix timestamp back to Date object.
 */
export function timestampToDate(timestamp?: number): Date | undefined {
  return timestamp ? new Date(timestamp * 1000) : undefined
}

/**
 * Converts Operation to DynamoDB item format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function operationToDynamoItem(operation: Operation): Record<string, any> {
  const now = Date.now()
  const ttl = Math.floor(now / 1000) + 24 * 60 * 60 // 24 hours from now

  return {
    id: operation.id,
    type: operation.type,
    status: operation.status,
    interviewId: operation.interviewId,
    candidateName: operation.candidateName,
    challenge: operation.challenge,
    saveFiles: operation.saveFiles,
    createdAt: dateToTimestamp(operation.createdAt),
    executionStartedAt: dateToTimestamp(operation.executionStartedAt),
    completedAt: dateToTimestamp(operation.completedAt),
    scheduledAt: dateToTimestamp(operation.scheduledAt),
    autoDestroyAt: dateToTimestamp(operation.autoDestroyAt),
    logs: operation.logs,
    result: operation.result,
    ttl, // TTL for automatic cleanup
  }
}

/**
 * Converts DynamoDB item to Operation format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dynamoItemToOperation(item: Record<string, any>): Operation {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    interviewId: item.interviewId,
    candidateName: item.candidateName,
    challenge: item.challenge,
    saveFiles: item.saveFiles,
    createdAt: timestampToDate(item.createdAt) || new Date(),
    executionStartedAt: timestampToDate(item.executionStartedAt),
    completedAt: timestampToDate(item.completedAt),
    scheduledAt: timestampToDate(item.scheduledAt),
    autoDestroyAt: timestampToDate(item.autoDestroyAt),
    logs: item.logs || [],
    result: item.result,
  }
}
