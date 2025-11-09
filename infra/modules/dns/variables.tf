# infra/modules/dns/variables.tf
variable "domain_name" {
  description = "Domain name for portal and interviews"
  type        = string
  default     = ""
}

variable "alb_dns_name" {
  description = "ALB DNS name"
  type        = string
}

variable "alb_zone_id" {
  description = "ALB zone ID"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
