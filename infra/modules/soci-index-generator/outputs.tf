output "lambda_function_arn" {
  description = "ARN of the SOCI index generator Lambda function"
  value       = aws_lambda_function.soci_index_generator.arn
}

output "lambda_function_name" {
  description = "Name of the SOCI index generator Lambda function"
  value       = aws_lambda_function.soci_index_generator.function_name
}

output "iam_role_arn" {
  description = "ARN of the Lambda IAM role"
  value       = aws_iam_role.soci_index_generator.arn
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.soci_index_generator.name
}

output "eventbridge_rule_arn" {
  description = "ARN of the EventBridge rule"
  value       = aws_cloudwatch_event_rule.ecr_image_push.arn
}

output "ecr_event_filtering_function_arn" {
  description = "ARN of the ECR event filtering Lambda function"
  value       = aws_lambda_function.ecr_event_filtering.arn
}

output "ecr_event_filtering_function_name" {
  description = "Name of the ECR event filtering Lambda function"
  value       = aws_lambda_function.ecr_event_filtering.function_name
}

output "build_info" {
  description = "Information about the Lambda build"
  value = {
    zip_exists = fileexists("${var.lambda_source_path}/soci-index-generator/soci_index_generator_lambda.zip")
    zip_hash   = data.local_file.soci_zip_hash.content_base64sha256
    build_time = timestamp()
  }
  depends_on = [null_resource.soci_index_generator_build]
}