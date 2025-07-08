terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    # Note: Backend bucket must be manually created before terraform apply
    bucket       = "prequel-terraform-state"
    key          = "prequel"
    region       = "your-aws-region"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "${var.project_prefix}-${var.environment}"
  tags = {
    Environment = var.environment
    Project     = var.project_prefix
    ManagedBy   = "terraform"
  }
}