# infra/modules/environment/variables.tf
variable "project_prefix" {
  description = "Project prefix for resource naming"
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

variable "domain_name" {
  description = "Domain name for portal"
  type        = string
  default     = ""
}

variable "terraform_state_bucket" {
  description = "S3 bucket for Terraform state"
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

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
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

# Shared networking inputs (sourced from the shared remote state by the caller)
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
