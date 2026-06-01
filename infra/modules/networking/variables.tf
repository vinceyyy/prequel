# infra/modules/networking/variables.tf
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of availability zones to use"
  type        = number
  default     = 3
}

variable "nat_gateway_count" {
  description = "Number of NAT gateways to provision. Use 1 to cut cost (single AZ failure domain for outbound traffic) or match availability_zone_count for full HA."
  type        = number
  default     = 3
}

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
