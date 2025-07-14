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

variable "code_server_image" {
  description = "Docker image for code-server"
  type        = string
  default     = "lscr.io/linuxserver/code-server:latest"
}

variable "code_server_cpu" {
  description = "CPU units for code-server tasks"
  type        = number
  default     = 1024
}

variable "code_server_memory" {
  description = "Memory (MiB) for code-server tasks"
  type        = number
  default     = 2048
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