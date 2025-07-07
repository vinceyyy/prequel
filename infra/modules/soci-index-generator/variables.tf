variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository to monitor for image pushes"
  type        = string
}

variable "ecr_repository_arn" {
  description = "ARN of the ECR repository to grant permissions to"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "lambda_timeout" {
  description = "Lambda function timeout in seconds"
  type        = number
  default     = 900
}

variable "lambda_memory_size" {
  description = "Lambda function memory size in MB"
  type        = number
  default     = 2048
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7
}

variable "soci_index_version" {
  description = "SOCI index version to use (V1 or V2)"
  type        = string
  default     = "V2"
}

variable "lambda_source_path" {
  description = "Path to the Lambda source code directory"
  type        = string
}

variable "repository_image_tag_filters" {
  description = "Comma-separated list of repository:tag patterns to filter for SOCI indexing (e.g., 'repo1:*,repo2:latest')"
  type        = string
  default     = "*:*"
}