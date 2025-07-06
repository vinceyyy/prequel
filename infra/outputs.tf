output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.main.arn
}


output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer"
  value       = aws_lb.main.zone_id
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.main.arn
}

output "alb_listener_arn" {
  description = "ARN of the ALB HTTP listener"
  value       = aws_lb_listener.http.arn
}

output "alb_https_listener_arn" {
  description = "ARN of the ALB HTTPS listener (if domain configured)"
  value       = var.domain_name != "" ? aws_lb_listener.https[0].arn : null
}

output "default_password_parameter_arn" {
  description = "ARN of the SSM parameter containing default password"
  value       = aws_ssm_parameter.default_password.arn
}

output "portal_url" {
  description = "URL for the portal interface"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}

output "domain_name" {
  description = "Configured domain name"
  value       = var.domain_name
}


output "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role"
  value       = aws_iam_role.ecs_execution.arn
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task role"
  value       = aws_iam_role.ecs_task.arn
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.portal.name
}

output "route53_zone_id" {
  description = "Route53 zone ID (if domain configured)"
  value       = var.domain_name != "" ? data.aws_route53_zone.main[0].zone_id : null
}

output "certificate_arn" {
  description = "ACM certificate ARN (if domain configured)"
  value       = var.domain_name != "" ? aws_acm_certificate_validation.main.certificate_arn : null
}

output "certificate_domain_validation_options" {
  description = "Certificate domain validation options"
  value       = var.domain_name != "" ? aws_acm_certificate.main.domain_validation_options : []
}

output "ecr_repository_url" {
  description = "ECR repository URL for the portal"
  value       = aws_ecr_repository.portal.repository_url
}

output "code_server_ecr_repository_url" {
  description = "ECR repository URL for the code-server"
  value       = aws_ecr_repository.code_server.repository_url
}

output "instance_code_bucket_name" {
  description = "S3 bucket name for storing interview instance terraform code"
  value       = aws_s3_bucket.instance_code.bucket
}

output "instance_code_bucket_arn" {
  description = "S3 bucket ARN for storing interview instance terraform code"
  value       = aws_s3_bucket.instance_code.arn
}

output "challenge_bucket_name" {
  description = "S3 bucket name for storing interview challenges"
  value       = aws_s3_bucket.challenges.bucket
}

output "challenge_bucket_arn" {
  description = "S3 bucket ARN for storing interview challenges"
  value       = aws_s3_bucket.challenges.arn
}

output "code_server_security_group_id" {
  description = "ID of the code server security group"
  value       = aws_security_group.code_server.id
}

