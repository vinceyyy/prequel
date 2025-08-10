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

variable "openai_project_id" {
  description = "The OpenAI project to provision service account in"
  type        = string
  sensitive   = false
}

variable "openai_service_account_name" {
  description = "The OpenAI service account name"
  type        = string
  sensitive   = false
}

variable "image_tag" {
  description = "Docker image tag for the code-server container"
  type        = string
  default     = "latest"
}
