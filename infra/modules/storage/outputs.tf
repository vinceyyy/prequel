# infra/modules/storage/outputs.tf
output "challenge_bucket_name" {
  description = "Challenge S3 bucket name"
  value       = aws_s3_bucket.challenge.id
}

output "challenge_bucket_arn" {
  description = "Challenge S3 bucket ARN"
  value       = aws_s3_bucket.challenge.arn
}

output "instance_bucket_name" {
  description = "Instance S3 bucket name"
  value       = aws_s3_bucket.instance.id
}

output "instance_bucket_arn" {
  description = "Instance S3 bucket ARN"
  value       = aws_s3_bucket.instance.arn
}

output "history_bucket_name" {
  description = "History S3 bucket name"
  value       = aws_s3_bucket.history.id
}

output "history_bucket_arn" {
  description = "History S3 bucket ARN"
  value       = aws_s3_bucket.history.arn
}

output "interviews_table_name" {
  description = "Interviews DynamoDB table name"
  value       = aws_dynamodb_table.interviews.name
}

output "interviews_table_arn" {
  description = "Interviews DynamoDB table ARN"
  value       = aws_dynamodb_table.interviews.arn
}

output "operations_table_name" {
  description = "Operations DynamoDB table name"
  value       = aws_dynamodb_table.operations.name
}

output "operations_table_arn" {
  description = "Operations DynamoDB table ARN"
  value       = aws_dynamodb_table.operations.arn
}

output "challenges_table_name" {
  description = "Challenges DynamoDB table name"
  value       = aws_dynamodb_table.challenges.name
}

output "challenges_table_arn" {
  description = "Challenges DynamoDB table ARN"
  value       = aws_dynamodb_table.challenges.arn
}
