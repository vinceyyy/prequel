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

# Storage module (DynamoDB, S3)
module "storage" {
  source = "../../modules/storage"

  project_prefix = var.project_prefix
  environment    = var.environment
  tags           = local.tags
}

# Compute module (ECS, ECR, ALB, IAM)
module "compute" {
  source = "../../modules/compute"

  name_prefix             = local.name_prefix
  project_prefix          = var.project_prefix
  environment             = var.environment
  aws_region              = var.aws_region
  vpc_id                  = data.terraform_remote_state.shared.outputs.vpc_id
  public_subnet_ids       = data.terraform_remote_state.shared.outputs.public_subnet_ids
  private_subnet_ids      = data.terraform_remote_state.shared.outputs.private_subnet_ids
  alb_security_group_id   = data.terraform_remote_state.shared.outputs.alb_security_group_id
  certificate_arn         = module.dns.certificate_arn
  domain_name             = var.domain_name
  challenge_bucket_arn    = module.storage.challenge_bucket_arn
  instance_bucket_arn     = module.storage.instance_bucket_arn
  history_bucket_arn      = module.storage.history_bucket_arn
  interviews_table_arn    = module.storage.interviews_table_arn
  operations_table_arn    = module.storage.operations_table_arn
  challenges_table_arn    = module.storage.challenges_table_arn
  terraform_state_bucket  = var.terraform_state_bucket
  enable_auth             = var.enable_auth
  auth_passcode           = var.auth_passcode
  openai_admin_key        = var.openai_admin_key
  openai_project_id       = var.openai_project_id
  log_level               = var.log_level
  tags                    = local.tags
}

# DNS module (Route53, ACM)
module "dns" {
  source = "../../modules/dns"

  domain_name  = var.domain_name
  alb_dns_name = module.compute.alb_dns_name
  alb_zone_id  = module.compute.alb_zone_id
  tags         = local.tags
}
