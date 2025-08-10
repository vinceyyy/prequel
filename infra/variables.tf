variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_prefix" {
  description = "Project prefix for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "terraform_state_bucket" {
  description = "S3 bucket name for Terraform state (must match backend configuration)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "domain_name" {
  description = "Domain name for code-server instances (e.g., prequel.app)"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
  default     = ""
}


variable "max_instances" {
  description = "Maximum number of concurrent code-server instances"
  type        = number
  default     = 10
}

# Authentication Configuration
variable "enable_auth" {
  description = "Enable password authentication for portal"
  type        = bool
  default     = true
}

variable "auth_passcode" {
  description = "Shared passcode for portal access"
  type        = string
  default     = "change-me-secure-passcode"
  sensitive   = true
}

variable "openai_admin_key" {
  description = "OpenAI admin key to provision service account"
  type        = string
  sensitive   = true
}

variable "openai_project_id" {
  description = "The OpenAI project to provision service account in"
  type        = string
  sensitive   = false
}

variable "log_level" {
  description = "Log level for application logging (debug, info, warn, error)"
  type        = string
  default     = "info"
  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "Log level must be one of: debug, info, warn, error"
  }
}
