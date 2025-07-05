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
  value = data.terraform_remote_state.infrastructure.outputs.domain_name != "" ? "https://${local.interview_id}.${data.terraform_remote_state.infrastructure.outputs.domain_name}/" : "http://${aws_lb.interview.dns_name}/"
}

output "alb_dns_name" {
  description = "DNS name of the interview ALB"
  value       = aws_lb.interview.dns_name
}

output "alb_arn" {
  description = "ARN of the interview ALB"
  value       = aws_lb.interview.arn
}

output "target_group_arn" {
  description = "ARN of the interview target group"
  value       = aws_lb_target_group.interview.arn
}

output "alb_security_group_id" {
  description = "ID of the interview ALB security group"
  value       = aws_security_group.interview_alb.id
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

output "scenario" {
  description = "Interview scenario"
  value       = var.scenario
}

output "created_at" {
  description = "Creation timestamp"
  value       = timestamp()
}