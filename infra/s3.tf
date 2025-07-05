# S3 bucket for storing interview instance terraform code
resource "aws_s3_bucket" "instance_code" {
  bucket = "prequel-instance"

  tags = merge(local.tags, {
    Name        = "prequel-instance"
    Description = "Storage for interview instance terraform code"
  })
}

resource "aws_s3_bucket_versioning" "instance_code" {
  bucket = aws_s3_bucket.instance_code.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "instance_code" {
  bucket = aws_s3_bucket.instance_code.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "instance_code" {
  bucket = aws_s3_bucket.instance_code.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle configuration to manage old versions
resource "aws_s3_bucket_lifecycle_configuration" "instance_code" {
  bucket = aws_s3_bucket.instance_code.id

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

# S3 bucket for storing interview scenarios
resource "aws_s3_bucket" "scenarios" {
  bucket = "prequel-scenario"

  tags = merge(local.tags, {
    Name        = "prequel-scenario"
    Description = "Storage for interview scenario files"
  })
}

resource "aws_s3_bucket_versioning" "scenarios" {
  bucket = aws_s3_bucket.scenarios.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scenarios" {
  bucket = aws_s3_bucket.scenarios.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "scenarios" {
  bucket = aws_s3_bucket.scenarios.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle configuration for scenarios
resource "aws_s3_bucket_lifecycle_configuration" "scenarios" {
  bucket = aws_s3_bucket.scenarios.id

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