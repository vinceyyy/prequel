# infra/modules/dns/outputs.tf
output "route53_zone_id" {
  description = "Route53 hosted zone ID"
  value       = try(data.aws_route53_zone.main[0].zone_id, "")
}

output "certificate_arn" {
  description = "ACM certificate ARN"
  value       = try(aws_acm_certificate.main[0].arn, "")
}

output "domain_name" {
  description = "Domain name"
  value       = var.domain_name
}
