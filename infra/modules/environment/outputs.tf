# infra/modules/environment/outputs.tf

# Compute outputs
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.compute.ecs_cluster_name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = module.compute.ecs_cluster_arn
}

output "portal_ecr_repository_url" {
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

output "alb_zone_id" {
  description = "ALB zone ID for Route53"
  value       = module.compute.alb_zone_id
}

output "alb_https_listener_arn" {
  description = "ALB HTTPS listener ARN"
  value       = module.compute.alb_https_listener_arn
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

# DNS outputs
output "route53_zone_id" {
  description = "Route53 zone ID"
  value       = module.dns.route53_zone_id
}

# Storage outputs
output "challenge_bucket_name" {
  description = "Challenge S3 bucket name"
  value       = module.storage.challenge_bucket_name
}
