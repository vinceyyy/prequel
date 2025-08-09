output "interview_id" {
  description = "Interview ID"
  value       = local.interview_id
}

output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.interview.name
}

output "access_url" {
  description = "URL to access the interview"
  value       = data.terraform_remote_state.common.outputs.domain_name != "" ? "https://${local.interview_id}.${data.terraform_remote_state.common.outputs.domain_name}/" : "http://${data.terraform_remote_state.common.outputs.alb_dns_name}/"
}

output "shared_alb_dns_name" {
  description = "DNS name of the shared ALB (same as portal)"
  value       = data.terraform_remote_state.common.outputs.alb_dns_name
}

output "target_group_arn" {
  description = "ARN of the interview target group"
  value       = aws_lb_target_group.interview.arn
}

output "listener_rule_arn" {
  description = "ARN of the ALB listener rule for this interview"
  value       = data.terraform_remote_state.common.outputs.domain_name != "" ? aws_lb_listener_rule.interview[0].arn : null
}

output "listener_rule_priority" {
  description = "Priority of the ALB listener rule"
  value       = random_integer.priority.result
}

output "ecs_security_group_id" {
  description = "ID of the interview ECS security group"
  value       = aws_security_group.interview_ecs.id
}

output "password" {
  description = "Interview password"
  value       = var.password
  sensitive   = true
}

output "candidate_name" {
  description = "Candidate name"
  value       = var.candidate_name
}

output "challenge" {
  description = "Interview challenge"
  value       = var.challenge
}

output "subdomain" {
  description = "Subdomain for this interview"
  value       = data.terraform_remote_state.common.outputs.domain_name != "" ? "${local.interview_id}.${data.terraform_remote_state.common.outputs.domain_name}" : null
}

output "route53_record_name" {
  description = "Route53 record name for the interview"
  value       = data.terraform_remote_state.common.outputs.domain_name != "" ? aws_route53_record.interview[0].name : null
}

output "created_at" {
  description = "Creation timestamp"
  value       = timestamp()
}