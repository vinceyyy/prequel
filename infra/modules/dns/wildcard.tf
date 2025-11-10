# infra/modules/dns/wildcard.tf

# Wildcard A record for interview instances (*.your-domain.com)
resource "aws_route53_record" "wildcard" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = "*.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
