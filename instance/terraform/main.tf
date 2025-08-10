terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1"
    }
    openai = {
      source  = "jianyuan/openai"
      version = "0.3.2"
    }
  }
  backend "s3" {
    bucket = "TERRAFORM_STATE_BUCKET_PLACEHOLDER"         # will be substitute by the portal at run time
    key    = "instances/INTERVIEW_ID_PLACEHOLDER.tfstate" # will be substitute by the portal at run time
    region = "AWS_REGION_PLACEHOLDER"                     # will be substitute by the portal at run time
  }
}

provider "aws" {
  region = var.aws_region
}

# Data source to read OpenAI admin key from SSM Parameter Store
data "aws_ssm_parameter" "openai_admin_key" {
  name = "/${data.terraform_remote_state.common.outputs.project_prefix}-${data.terraform_remote_state.common.outputs.environment}/openai/admin-key"
}

provider "openai" {
  admin_key = data.aws_ssm_parameter.openai_admin_key.value
}

data "terraform_remote_state" "common" {
  backend = "s3"
  config = {
    bucket = "TERRAFORM_STATE_BUCKET_PLACEHOLDER" # will be substitute by the portal at run time
    key    = "common"
    region = "AWS_REGION_PLACEHOLDER" # will be substitute by the portal at run time
  }
}

locals {
  interview_id   = var.interview_id
  candidate_name = replace(lower(var.candidate_name), " ", "-")
  service_name   = "interview-${local.interview_id}"
  tags = {
    InterviewId   = local.interview_id
    CandidateName = var.candidate_name
    Challenge     = var.challenge
    Environment   = "interview"
    ManagedBy     = "terraform"
    CreatedAt     = timestamp()
  }
}