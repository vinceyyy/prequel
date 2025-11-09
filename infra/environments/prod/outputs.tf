# infra/environments/dev/outputs.tf
output "vpc_id" {
  description = "VPC ID (from shared)"
  value       = data.terraform_remote_state.shared.outputs.vpc_id
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.compute.ecs_cluster_name
}

output "ecr_repository_url" {
  description = "Portal ECR repository URL"
  value       = module.compute.portal_ecr_repository_url
}

output "code_server_ecr_repository_url" {
  description = "Code server ECR repository URL"
  value       = module.compute.code_server_ecr_repository_url
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.compute.alb_dns_name
}

output "domain_name" {
  description = "Domain name"
  value       = var.domain_name
}

output "portal_url" {
  description = "Portal URL"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://${module.compute.alb_dns_name}"
}

# Outputs needed by instance terraform
output "project_prefix" {
  description = "Project prefix"
  value       = var.project_prefix
}

output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = data.terraform_remote_state.shared.outputs.alb_security_group_id
}

output "alb_https_listener_arn" {
  description = "ALB HTTPS listener ARN"
  value       = module.compute.alb_https_listener_arn
}

output "route53_zone_id" {
  description = "Route53 zone ID"
  value       = module.dns.route53_zone_id
}

output "challenge_bucket_name" {
  description = "Challenge S3 bucket name"
  value       = module.storage.challenge_bucket_name
}

output "ecs_execution_role_arn" {
  description = "ECS execution role ARN"
  value       = module.compute.ecs_execution_role_arn
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = module.compute.ecs_task_role_arn
}

output "interview_cloudwatch_log_group_name" {
  description = "Interview CloudWatch log group name"
  value       = module.compute.interview_cloudwatch_log_group_name
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = data.terraform_remote_state.shared.outputs.private_subnet_ids
}
