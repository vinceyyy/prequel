# infra/modules/compute/variables.tf
variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "project_prefix" {
  description = "Project prefix for application config"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "ALB security group ID"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Domain name for portal"
  type        = string
  default     = ""
}

variable "challenge_bucket_arn" {
  description = "Challenge S3 bucket ARN"
  type        = string
}

variable "instance_bucket_arn" {
  description = "Instance S3 bucket ARN"
  type        = string
}

variable "history_bucket_arn" {
  description = "History S3 bucket ARN"
  type        = string
}

variable "interviews_table_arn" {
  description = "Interviews DynamoDB table ARN"
  type        = string
}

variable "operations_table_arn" {
  description = "Operations DynamoDB table ARN"
  type        = string
}

variable "challenges_table_arn" {
  description = "Challenges DynamoDB table ARN"
  type        = string
}

variable "apikeys_table_arn" {
  description = "API keys DynamoDB table ARN"
  type        = string
}

variable "terraform_state_bucket" {
  description = "Terraform state S3 bucket name"
  type        = string
}

variable "enable_auth" {
  description = "Enable authentication for portal"
  type        = bool
  default     = true
}

variable "auth_passcode" {
  description = "Portal authentication passcode"
  type        = string
  sensitive   = true
}

variable "openai_admin_key" {
  description = "OpenAI admin API key"
  type        = string
  sensitive   = true
}

variable "openai_project_id" {
  description = "OpenAI project ID"
  type        = string
}

variable "log_level" {
  description = "Log level for portal"
  type        = string
  default     = "info"
}

variable "node_env" {
  description = "Node environment (production recommended for both staging and prod)"
  type        = string
  default     = "production"
}

variable "portal_cpu" {
  description = "CPU units for portal task (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 512
}

variable "portal_memory" {
  description = "Memory in MB for portal task"
  type        = number
  default     = 1024
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
