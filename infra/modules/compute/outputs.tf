# infra/modules/compute/outputs.tf
output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_execution_role_arn" {
  description = "ECS execution role ARN"
  value       = aws_iam_role.ecs_execution_role.arn
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = aws_iam_role.ecs_task_role.arn
}

output "portal_ecr_repository_url" {
  description = "Portal ECR repository URL"
  value       = aws_ecr_repository.portal.repository_url
}

output "code_server_ecr_repository_url" {
  description = "Code server ECR repository URL"
  value       = aws_ecr_repository.code_server.repository_url
}

output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB zone ID for Route53"
  value       = aws_lb.main.zone_id
}

output "alb_https_listener_arn" {
  description = "ALB HTTPS listener ARN"
  value       = try(aws_lb_listener.https[0].arn, "")
}

output "portal_cloudwatch_log_group_name" {
  description = "Portal CloudWatch log group name"
  value       = aws_cloudwatch_log_group.portal.name
}

output "interview_cloudwatch_log_group_name" {
  description = "Interview CloudWatch log group name"
  value       = aws_cloudwatch_log_group.interview.name
}
