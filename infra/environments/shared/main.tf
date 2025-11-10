# infra/environments/shared/main.tf
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket       = ""
    key          = ""
    region       = ""
    use_lockfile = ""
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project_prefix}-shared"
  tags = {
    Environment = "shared"
    Project     = var.project_prefix
    ManagedBy   = "terraform"
  }
}

module "networking" {
  source = "../../modules/networking"

  vpc_cidr                = var.vpc_cidr
  availability_zone_count = 3
  name_prefix             = local.name_prefix
  tags                    = local.tags
}
