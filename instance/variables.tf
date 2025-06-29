variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "your-aws-region"
}

variable "interview_id" {
  description = "Unique interview identifier"
  type        = string
}

variable "candidate_name" {
  description = "Name of the candidate"
  type        = string
}

variable "scenario" {
  description = "Interview scenario type"
  type        = string
  validation {
    condition = contains(["javascript", "python", "sql", "fullstack"], var.scenario)
    error_message = "Scenario must be one of: javascript, python, sql, fullstack"
  }
}

variable "password" {
  description = "Password for code-server access"
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Domain name for subdomain routing (optional)"
  type        = string
  default     = ""
}

variable "auto_destroy_after_hours" {
  description = "Hours after which to auto-destroy the interview instance"
  type        = number
  default     = 6
}