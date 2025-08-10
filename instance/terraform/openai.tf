resource "openai_project_service_account" "account" {
  project_id = var.openai_project_id
  name       = var.openai_service_account_name
}
