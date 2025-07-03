terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "prequel-terraform-state"
    key    = "interview-instances/INTERVIEW_ID_PLACEHOLDER.tfstate"
    region = "your-aws-region"
  }
}

provider "aws" {
  region = var.aws_region
}

data "terraform_remote_state" "infrastructure" {
  backend = "s3"
  config = {
    bucket = "prequel-terraform-state"
    key    = "prequel"
    region = "your-aws-region"
  }
}

locals {
  interview_id = var.interview_id
  candidate_name = replace(lower(var.candidate_name), " ", "-")
  service_name = "interview-${local.interview_id}"
  tags = {
    InterviewId    = local.interview_id
    CandidateName  = var.candidate_name
    Scenario       = var.scenario
    Environment    = "interview"
    ManagedBy      = "terraform"
    CreatedAt      = timestamp()
  }
}