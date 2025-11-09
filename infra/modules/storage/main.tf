# infra/modules/storage/main.tf

# ============================================================================
# S3 Buckets - Challenge Storage
# ============================================================================

resource "aws_s3_bucket" "challenge" {
  bucket = "${var.project_prefix}-${var.environment}-challenge"

  tags = merge(var.tags, {
    Name        = "${var.project_prefix}-${var.environment}-challenge"
    Description = "Storage for interview challenge files"
  })
}

resource "aws_s3_bucket_versioning" "challenge" {
  bucket = aws_s3_bucket.challenge.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "challenge" {
  bucket = aws_s3_bucket.challenge.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "challenge" {
  bucket = aws_s3_bucket.challenge.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "challenge" {
  bucket = aws_s3_bucket.challenge.id

  rule {
    id     = "cleanup_old_versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ============================================================================
# S3 Buckets - Instance Code Storage
# ============================================================================

resource "aws_s3_bucket" "instance" {
  bucket = "${var.project_prefix}-${var.environment}-instance"

  tags = merge(var.tags, {
    Name        = "${var.project_prefix}-${var.environment}-instance"
    Description = "Storage for interview instance terraform code"
  })
}

resource "aws_s3_bucket_versioning" "instance" {
  bucket = aws_s3_bucket.instance.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "instance" {
  bucket = aws_s3_bucket.instance.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "instance" {
  bucket = aws_s3_bucket.instance.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "instance" {
  bucket = aws_s3_bucket.instance.id

  rule {
    id     = "cleanup_old_versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ============================================================================
# S3 Buckets - Interview History Storage
# ============================================================================

resource "aws_s3_bucket" "history" {
  bucket = "${var.project_prefix}-${var.environment}-history"

  tags = merge(var.tags, {
    Name        = "${var.project_prefix}-${var.environment}-history"
    Description = "Storage for candidate interview files and metadata"
  })
}

resource "aws_s3_bucket_versioning" "history" {
  bucket = aws_s3_bucket.history.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "history" {
  bucket = aws_s3_bucket.history.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "history" {
  bucket = aws_s3_bucket.history.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "history" {
  bucket = aws_s3_bucket.history.id

  rule {
    id     = "cleanup_old_versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ============================================================================
# DynamoDB Tables - Interviews
# ============================================================================

resource "aws_dynamodb_table" "interviews" {
  name                        = "${var.project_prefix}-${var.environment}-interviews"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
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
    enabled        = true
    attribute_name = "ttl"
  }

  # Enable point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption
  server_side_encryption {
    enabled = true
  }

  tags = merge(var.tags, {
    Name        = "${var.project_prefix}-${var.environment}-interviews"
    Description = "Interview metadata and history storage"
  })
}

# ============================================================================
# DynamoDB Tables - Operations
# ============================================================================

resource "aws_dynamodb_table" "operations" {
  name                        = "${var.project_prefix}-${var.environment}-operations"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
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
    enabled        = true
    attribute_name = "ttl"
  }

  # Enable point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption
  server_side_encryption {
    enabled = true
  }

  tags = merge(var.tags, {
    Name        = "${var.project_prefix}-${var.environment}-operations"
    Description = "Operation state persistence for interview management"
  })
}

# ============================================================================
# DynamoDB Tables - Challenges
# ============================================================================

resource "aws_dynamodb_table" "challenges" {
  name                        = "${var.project_prefix}-${var.environment}-challenges"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
  deletion_protection_enabled = false

  # Primary key: Challenge ID
  attribute {
    name = "id"
    type = "S"
  }

  # GSI attributes for querying by status and creation date
  attribute {
    name = "isActive"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "N"
  }

  # GSI attributes for querying by usage statistics
  attribute {
    name = "usageCount"
    type = "N"
  }

  attribute {
    name = "lastUsedAt"
    type = "N"
  }

  # Global Secondary Index: Query active challenges by creation date
  # Usage: List all active challenges, sort by newest first
  global_secondary_index {
    name            = "isActive-createdAt-index"
    hash_key        = "isActive"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  # Global Secondary Index: Query challenges by usage statistics
  # Usage: Find most/least used challenges, recently used challenges
  global_secondary_index {
    name            = "isActive-usageCount-index"
    hash_key        = "isActive"
    range_key       = "usageCount"
    projection_type = "ALL"
  }

  # Global Secondary Index: Query challenges by last used date
  # Usage: Find recently used challenges, stale challenges
  global_secondary_index {
    name            = "isActive-lastUsedAt-index"
    hash_key        = "isActive"
    range_key       = "lastUsedAt"
    projection_type = "ALL"
  }

  # Enable point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption
  server_side_encryption {
    enabled = true
  }

  tags = merge(var.tags, {
    Name        = "${var.project_prefix}-${var.environment}-challenges"
    Description = "Challenge metadata and configuration storage"
  })
}
