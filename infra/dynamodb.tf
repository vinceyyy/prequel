/**
 * DynamoDB table for persisting operation state across container restarts.
 * 
 * This table stores all background operations (interview creation/destruction)
 * and their associated metadata, logs, and status. It replaces the ephemeral
 * file-based persistence that would be lost on ECS container restarts.
 *
 * Key features:
 * - TTL for automatic cleanup of old operations (24 hours)
 * - GSI for efficient queries by interview ID and operation type
 * - Atomic updates for operation status changes
 * - Point-in-time recovery for data protection
 */

resource "aws_dynamodb_table" "operations" {
  name           = "${local.name}-operations"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"
  deletion_protection_enabled = false

  # Primary key: Operation ID
  attribute {
    name = "id"
    type = "S"
  }

  # GSI attributes for querying by interview
  attribute {
    name = "interviewId"
    type = "S"
  }

  attribute {
    name = "type"
    type = "S"
  }

  # GSI attributes for querying by status and scheduled time
  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "scheduledAt"
    type = "N"
  }

  attribute {
    name = "autoDestroyAt"
    type = "N"
  }

  # Global Secondary Index: Query operations by interview ID and type
  # Usage: Find all operations for a specific interview, or check if destroy operation exists
  global_secondary_index {
    name            = "interviewId-type-index"
    hash_key        = "interviewId"
    range_key       = "type"
    projection_type = "ALL"
  }

  # Global Secondary Index: Query scheduled operations
  # Usage: Find all scheduled operations that need to be executed
  global_secondary_index {
    name            = "status-scheduledAt-index"
    hash_key        = "status"
    range_key       = "scheduledAt"
    projection_type = "ALL"
  }

  # Global Secondary Index: Query operations for auto-destroy
  # Usage: Find completed create operations past their auto-destroy time
  global_secondary_index {
    name            = "status-autoDestroyAt-index"
    hash_key        = "status"
    range_key       = "autoDestroyAt"
    projection_type = "ALL"
  }

  # TTL configuration - automatically delete operations after 24 hours
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Enable point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption
  server_side_encryption {
    enabled = true
  }

  tags = merge(local.tags, {
    Name        = "${local.name}-operations"
    Description = "Operation state persistence for interview management"
  })
}

/**
 * DynamoDB table for storing interview metadata and history.
 * 
 * This table serves as the source of truth for interview state, replacing
 * the inefficient S3-based querying system. It stores both active and
 * historical interviews with their metadata, status, and file locations.
 *
 * Key features:
 * - Fast queries by status for active vs historical interviews
 * - TTL for automatic cleanup of old historical records (90 days)
 * - GSI for efficient queries by candidate name and creation date
 * - Atomic status updates for real-time tracking
 */

resource "aws_dynamodb_table" "interviews" {
  name           = "${local.name}-interviews"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"
  deletion_protection_enabled = false

  # Primary key: Interview ID
  attribute {
    name = "id"
    type = "S"
  }

  # GSI attributes for querying by status and creation date
  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "N"
  }

  # GSI attributes for querying by candidate name
  attribute {
    name = "candidateName"
    type = "S"
  }

  # Global Secondary Index: Query interviews by status and creation date
  # Usage: Separate active interviews from historical ones, sort by date
  global_secondary_index {
    name            = "status-createdAt-index"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # Global Secondary Index: Query interviews by candidate name and creation date
  # Usage: Find all interviews for a specific candidate, search functionality
  global_secondary_index {
    name            = "candidateName-createdAt-index"
    hash_key        = "candidateName"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # TTL configuration - automatically delete historical records after 90 days
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Enable point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption
  server_side_encryption {
    enabled = true
  }

  tags = merge(local.tags, {
    Name        = "${local.name}-interviews"
    Description = "Interview metadata and history storage"
  })
}