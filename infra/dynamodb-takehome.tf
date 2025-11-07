resource "aws_dynamodb_table" "takehome" {
  name         = "${var.project_prefix}-${var.environment}-takehome"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "passcode"

  attribute {
    name = "passcode"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Name        = "${var.project_prefix}-${var.environment}-takehome"
    Environment = var.environment
    Project     = var.project_prefix
  }
}
