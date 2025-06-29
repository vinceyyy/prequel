terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
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
  name = "prequel-${var.environment}"
  tags = {
    Environment = var.environment
    Project     = "prequel"
    ManagedBy   = "terraform"
  }
}