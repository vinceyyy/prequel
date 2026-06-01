# infra/modules/environment/main.tf
locals {
  name_prefix = "${var.project_prefix}-${var.environment}"
}

# Storage module (DynamoDB, S3)
module "storage" {
  source = "../storage"

  project_prefix = var.project_prefix
  environment    = var.environment
  tags           = var.tags
}

# Compute module (ECS, ECR, ALB, IAM)
module "compute" {
  source = "../compute"

  name_prefix            = local.name_prefix
  project_prefix         = var.project_prefix
  environment            = var.environment
  aws_region             = var.aws_region
  vpc_id                 = var.vpc_id
  public_subnet_ids      = var.public_subnet_ids
  private_subnet_ids     = var.private_subnet_ids
  alb_security_group_id  = var.alb_security_group_id
  certificate_arn        = module.dns.certificate_arn
  domain_name            = var.domain_name
  challenge_bucket_arn   = module.storage.challenge_bucket_arn
  instance_bucket_arn    = module.storage.instance_bucket_arn
  history_bucket_arn     = module.storage.history_bucket_arn
  interviews_table_arn   = module.storage.interviews_table_arn
  operations_table_arn   = module.storage.operations_table_arn
  challenges_table_arn   = module.storage.challenges_table_arn
  apikeys_table_arn      = module.storage.apikeys_table_arn
  terraform_state_bucket = var.terraform_state_bucket
  enable_auth            = var.enable_auth
  auth_passcode          = var.auth_passcode
  openai_admin_key       = var.openai_admin_key
  openai_project_id      = var.openai_project_id
  log_level              = var.log_level
  tags                   = var.tags
  portal_cpu             = var.portal_cpu
  portal_memory          = var.portal_memory
  log_retention_days     = var.log_retention_days
}

# DNS module (Route53, ACM)
module "dns" {
  source = "../dns"

  domain_name  = var.domain_name
  alb_dns_name = module.compute.alb_dns_name
  alb_zone_id  = module.compute.alb_zone_id
  tags         = var.tags
}
