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
  value = "Direct access via ECS service - check ECS console for public IP:8080"
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