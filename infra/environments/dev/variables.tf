# infra/environments/dev/variables.tf
variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "project_prefix" {
  description = "Project prefix for resource naming"
  type        = string
}

variable "terraform_state_bucket" {
  description = "S3 bucket for Terraform state"
  type        = string
}

variable "domain_name" {
  description = "Domain name for portal"
  type        = string
  default     = ""
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
