
# IAM role for Lambda function
resource "aws_iam_role" "soci_indexer" {
  name = "${local.name}-soci-indexer-role"

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

  tags = local.tags
}

# Attach basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "soci_indexer_basic" {
  role       = aws_iam_role.soci_indexer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ECR permissions for Lambda
resource "aws_iam_role_policy" "soci_indexer_ecr" {
  name = "${local.name}-soci-indexer-ecr-policy"
  role = aws_iam_role.soci_indexer.id

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
          aws_ecr_repository.code_server.arn,
          "${aws_ecr_repository.code_server.arn}/*"
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
}

resource "aws_iam_role_policy_attachment" "soci_indexer_ecr" {
  role       = aws_iam_role.soci_indexer.name
  policy_arn = aws_iam_policy.soci_indexer_ecr.arn
}

resource "aws_iam_policy" "soci_indexer_ecr" {
  name        = "${local.name}-soci-indexer-ecr-policy"
  description = "ECR permissions for SOCI indexer Lambda"

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
          aws_ecr_repository.code_server.arn,
          "${aws_ecr_repository.code_server.arn}/*"
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

  tags = local.tags
}

# CloudWatch log group for Lambda
resource "aws_cloudwatch_log_group" "soci_indexer" {
  name              = "/aws/lambda/${local.name}-soci-indexer"
  retention_in_days = 7

  tags = local.tags
}

# EventBridge rule to trigger Lambda on ECR image push
resource "aws_cloudwatch_event_rule" "ecr_image_push" {
  name        = "${local.name}-ecr-image-push"
  description = "Trigger SOCI indexer when image is pushed to ECR"

  event_pattern = jsonencode({
    source      = ["aws.ecr"]
    detail-type = ["ECR Image Action"]
    detail = {
      action-type     = ["PUSH"]
      repository-name = [aws_ecr_repository.code_server.name]
    }
  })

  tags = local.tags
}

# EventBridge target to invoke Lambda
resource "aws_cloudwatch_event_target" "soci_indexer" {
  rule      = aws_cloudwatch_event_rule.ecr_image_push.name
  target_id = "SOCIIndexerTarget"
  arn       = aws_lambda_function.soci_indexer.arn
}

# Permission for EventBridge to invoke Lambda
resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.soci_indexer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ecr_image_push.arn
}

# Lambda function source code
data "archive_file" "soci_indexer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/soci-indexer"
  output_path = "${path.module}/soci-indexer.zip"
}

# Update Lambda function to use the archive
resource "aws_lambda_function" "soci_indexer" {
  filename      = data.archive_file.soci_indexer_zip.output_path
  function_name = "${local.name}-soci-indexer"
  role          = aws_iam_role.soci_indexer.arn
  handler       = "index.handler"
  runtime       = "python3.11"
  timeout       = 900 # 15 minutes
  memory_size   = 1024

  environment {
    variables = {
      ECR_REPOSITORY = aws_ecr_repository.code_server.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.soci_indexer_basic,
    aws_iam_role_policy_attachment.soci_indexer_ecr,
    aws_cloudwatch_log_group.soci_indexer,
    data.archive_file.soci_indexer_zip,
  ]

  tags = local.tags
}