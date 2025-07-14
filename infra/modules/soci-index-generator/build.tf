# SOCI Index Generator Lambda Build Resources
# Handles automatic building of the Go Lambda function

# Null resource to build Lambda zip when source changes
resource "null_resource" "soci_index_generator_build" {
  # Trigger rebuild when any Go source files change
  triggers = {
    go_mod_hash     = filebase64sha256("${var.lambda_source_path}/soci-index-generator/go.mod")
    go_sum_hash     = filebase64sha256("${var.lambda_source_path}/soci-index-generator/go.sum")
    dockerfile_hash = filebase64sha256("${var.lambda_source_path}/soci-index-generator/Dockerfile")
    makefile_hash   = filebase64sha256("${var.lambda_source_path}/soci-index-generator/Makefile")
    handler_hash    = filebase64sha256("${var.lambda_source_path}/soci-index-generator/handler.go")
    # Add more source file hashes as needed for complete dependency tracking
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      echo "🔨 Building SOCI Index Generator Lambda..."
      
      cd "${var.lambda_source_path}/soci-index-generator"
      
      # Remove old zip if exists
      rm -f soci_index_generator_lambda.zip
      
      # Build using Docker
      echo "📦 Building Go binary and creating zip..."
      docker build --platform linux/amd64 -t soci-index-generator-builder .
      
      # Extract the zip file from the container
      echo "📤 Extracting zip from container..."
      CONTAINER_ID=$(docker create soci-index-generator-builder)
      docker cp $${CONTAINER_ID}:/build/soci_index_generator_lambda.zip .
      docker rm $${CONTAINER_ID}
      
      # Verify zip was created
      if [ ! -f "soci_index_generator_lambda.zip" ]; then
        echo "❌ Failed to create soci_index_generator_lambda.zip"
        exit 1
      fi
      
      echo "✅ Lambda zip created: $(ls -lh soci_index_generator_lambda.zip)"
      
      # Clean up Docker image
      docker rmi soci-index-generator-builder 2>/dev/null || true
    EOT
  }

  # Clean up Docker images on destroy
  provisioner "local-exec" {
    when    = destroy
    command = "docker rmi -f soci-index-generator-builder 2>/dev/null || true"
  }
}

# Note: Using filebase64sha256() directly instead of data.local_file
# to avoid circular dependency issues during terraform plan phase

# Zip-based Go Lambda function
resource "aws_lambda_function" "soci_index_generator" {
  function_name = "${var.name_prefix}-soci-index-generator"
  role          = aws_iam_role.soci_index_generator.arn
  filename      = "${var.lambda_source_path}/soci-index-generator/soci_index_generator_lambda.zip"
  handler       = "bootstrap"
  runtime       = "provided.al2"
  timeout       = var.lambda_timeout
  memory_size   = var.lambda_memory_size

  ephemeral_storage {
    size = 10240 # 10GB temporary storage for large images
  }

  source_code_hash = filebase64sha256("${var.lambda_source_path}/soci-index-generator/soci_index_generator_lambda.zip")

  environment {
    variables = {
      ECR_REPOSITORY     = var.ecr_repository_name
      soci_index_version = var.soci_index_version
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.soci_index_generator_basic,
    aws_iam_role_policy_attachment.soci_index_generator_ecr,
    aws_cloudwatch_log_group.soci_index_generator,
    null_resource.soci_index_generator_build,
  ]

  tags = var.tags
}