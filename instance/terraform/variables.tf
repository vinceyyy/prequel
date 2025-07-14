variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "interview_id" {
  description = "Unique interview identifier"
  type        = string
}

variable "candidate_name" {
  description = "Name of the candidate"
  type        = string
}

variable "challenge" {
  description = "Interview challenge type"
  type        = string
}

variable "password" {
  description = "Password for code-server access"
  type        = string
  sensitive   = true
}
