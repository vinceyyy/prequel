# infra/environments/dev/main.tf
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
  name_prefix = "${var.project_prefix}-${var.environment}"
  tags = {
    Environment = var.environment
    Project     = var.project_prefix
    ManagedBy   = "terraform"
  }
}

module "environment" {
  source = "../../modules/environment"

  project_prefix         = var.project_prefix
  environment            = var.environment
  aws_region             = var.aws_region
  domain_name            = var.domain_name
  terraform_state_bucket = var.terraform_state_bucket
  enable_auth            = var.enable_auth
  auth_passcode          = var.auth_passcode
  openai_admin_key       = var.openai_admin_key
  openai_project_id      = var.openai_project_id
  log_level              = var.log_level
  tags                   = local.tags

  # Shared networking
  vpc_id                = data.terraform_remote_state.shared.outputs.vpc_id
  public_subnet_ids     = data.terraform_remote_state.shared.outputs.public_subnet_ids
  private_subnet_ids    = data.terraform_remote_state.shared.outputs.private_subnet_ids
  alb_security_group_id = data.terraform_remote_state.shared.outputs.alb_security_group_id

  # Development sizing: 0.5 vCPU, 1 GB memory.
  # 512 MB OOM-kills the in-container terraform plan during interview provisioning,
  # so dev needs at least 1 GB to actually create instances.
  portal_cpu    = 512
  portal_memory = 1024
}

moved {
  from = module.storage
  to   = module.environment.module.storage
}

moved {
  from = module.compute
  to   = module.environment.module.compute
}

moved {
  from = module.dns
  to   = module.environment.module.dns
}
