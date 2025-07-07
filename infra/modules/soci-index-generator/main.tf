# SOCI Index Generator Lambda Module
# This module creates all resources needed for automatic SOCI index generation

# IAM role for Lambda function
resource "aws_iam_role" "soci_index_generator" {
  name = "${var.name_prefix}-soci-index-generator-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# Attach basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "soci_index_generator_basic" {
  role       = aws_iam_role.soci_index_generator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ECR permissions policy for Lambda
resource "aws_iam_policy" "soci_index_generator_ecr" {
  name        = "${var.name_prefix}-soci-index-generator-ecr-policy"
  description = "ECR permissions for SOCI index generator Lambda"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:GetAuthorizationToken",
          "ecr:ListImages",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = [
          var.ecr_repository_arn,
          "${var.ecr_repository_arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "soci_index_generator_ecr" {
  role       = aws_iam_role.soci_index_generator.name
  policy_arn = aws_iam_policy.soci_index_generator_ecr.arn
}

# CloudWatch log group for Lambda
resource "aws_cloudwatch_log_group" "soci_index_generator" {
  name              = "/aws/lambda/${var.name_prefix}-soci-index-generator"
  retention_in_days = var.log_retention_days

  tags = var.tags
}

# EventBridge rule to trigger Lambda on ECR image push
resource "aws_cloudwatch_event_rule" "ecr_image_push" {
  name        = "${var.name_prefix}-ecr-image-push"
  description = "Trigger SOCI index generator when image is pushed to ECR"

  event_pattern = jsonencode({
    source      = ["aws.ecr"]
    detail-type = ["ECR Image Action"]
    detail = {
      action-type     = ["PUSH"]
      result          = ["SUCCESS"]
      repository-name = [var.ecr_repository_name]
    }
  })

  tags = var.tags
}

# EventBridge target to invoke the event filtering Lambda (not the SOCI generator directly)
resource "aws_cloudwatch_event_target" "ecr_event_filtering" {
  rule      = aws_cloudwatch_event_rule.ecr_image_push.name
  target_id = "ECREventFilteringTarget"
  arn       = aws_lambda_function.ecr_event_filtering.arn
}

# Permission for EventBridge to invoke the event filtering Lambda
resource "aws_lambda_permission" "allow_eventbridge_filtering" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ecr_event_filtering.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ecr_image_push.arn
}