# ECR Image Action Event Filtering Lambda
# This Lambda filters ECR events and prevents infinite loops when SOCI indexes are created

# ZIP archive for the event filtering Lambda
data "archive_file" "ecr_event_filtering_zip" {
  type        = "zip"
  source_dir  = "${var.lambda_source_path}/ecr-image-action-event-filtering"
  output_path = "${var.lambda_source_path}/ecr-image-action-event-filtering.zip"
}

# IAM role for the event filtering Lambda
resource "aws_iam_role" "ecr_event_filtering" {
  name = "${var.name_prefix}-ecr-event-filtering-role"

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

# Attach basic Lambda execution policy for event filtering Lambda
resource "aws_iam_role_policy_attachment" "ecr_event_filtering_basic" {
  role       = aws_iam_role.ecr_event_filtering.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# IAM policy for the event filtering Lambda to invoke the SOCI indexer
resource "aws_iam_policy" "ecr_event_filtering_invoke" {
  name        = "${var.name_prefix}-ecr-event-filtering-invoke-policy"
  description = "Allow event filtering Lambda to invoke SOCI index generator"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.soci_index_generator.arn
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecr_event_filtering_invoke" {
  role       = aws_iam_role.ecr_event_filtering.name
  policy_arn = aws_iam_policy.ecr_event_filtering_invoke.arn
}

# CloudWatch log group for event filtering Lambda
resource "aws_cloudwatch_log_group" "ecr_event_filtering" {
  name              = "/aws/lambda/${var.name_prefix}-ecr-event-filtering"
  retention_in_days = var.log_retention_days

  tags = var.tags
}

# Event filtering Lambda function
resource "aws_lambda_function" "ecr_event_filtering" {
  function_name = "${var.name_prefix}-ecr-event-filtering"
  role         = aws_iam_role.ecr_event_filtering.arn
  filename      = data.archive_file.ecr_event_filtering_zip.output_path
  handler       = "ecr_image_action_event_filtering_lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 60
  memory_size   = 256

  source_code_hash = data.archive_file.ecr_event_filtering_zip.output_base64sha256

  environment {
    variables = {
      soci_repository_image_tag_filters = var.repository_image_tag_filters
      soci_index_generator_lambda_arn   = aws_lambda_function.soci_index_generator.arn
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.ecr_event_filtering_basic,
    aws_iam_role_policy_attachment.ecr_event_filtering_invoke,
    aws_cloudwatch_log_group.ecr_event_filtering,
  ]

  tags = var.tags
}