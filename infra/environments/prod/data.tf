# infra/environments/dev/data.tf
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = var.terraform_state_bucket
    key    = "shared/terraform.tfstate"
    region = var.aws_region
  }
}
