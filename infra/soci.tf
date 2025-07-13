# SOCI Index Generator
# Automatically generates SOCI indexes when container images are pushed to ECR

module "soci_index_generator" {
  source = "./modules/soci-index-generator"

  name_prefix         = local.name
  ecr_repository_name = aws_ecr_repository.code_server.name
  ecr_repository_arn  = aws_ecr_repository.code_server.arn
  lambda_source_path  = "${path.module}/modules/soci-index-generator/lambda"

  # Repository and tag filters for SOCI indexing
  repository_image_tag_filters = "${aws_ecr_repository.code_server.name}:*"

  # Optional configuration
  lambda_timeout     = 900  # 15 minutes
  lambda_memory_size = 2048 # 2GB for SOCI operations
  log_retention_days = 7
  soci_index_version = "V2"

  tags = local.tags
}

# Output important information about the SOCI setup
output "soci_index_generator" {
  description = "SOCI Index Generator information"
  value = {
    # SOCI Index Generator Lambda
    soci_lambda_function_name = module.soci_index_generator.lambda_function_name
    soci_lambda_function_arn  = module.soci_index_generator.lambda_function_arn
    soci_log_group_name       = module.soci_index_generator.cloudwatch_log_group_name

    # Event Filtering Lambda
    event_filter_function_name = module.soci_index_generator.ecr_event_filtering_function_name
    event_filter_function_arn  = module.soci_index_generator.ecr_event_filtering_function_arn

    # Build and configuration info
    build_info         = module.soci_index_generator.build_info
    repository_filters = "${aws_ecr_repository.code_server.name}:*"
  }
}