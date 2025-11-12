# infra/modules/compute/iam.tf

# ECS Task Execution Role (for pulling images, writing logs)
resource "aws_iam_role" "ecs_execution_role" {
  name = "${var.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution_role_policy" {
  role       = aws_iam_role.ecs_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Additional permissions for SSM parameters
resource "aws_iam_role_policy" "ecs_execution_ssm" {
  name = "${var.name_prefix}-ecs-execution-ssm"
  role = aws_iam_role.ecs_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:GetParameters",
        "ssm:GetParameter"
      ]
      Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/${var.project_prefix}/*"
    }]
  })
}

# ECS Task Role (for application permissions - S3, DynamoDB, etc.)
resource "aws_iam_role" "ecs_task_role" {
  name = "${var.name_prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

# S3 permissions for task role
resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.name_prefix}-ecs-task-s3"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ]
      Resource = [
        "${var.challenge_bucket_arn}",
        "${var.challenge_bucket_arn}/*",
        "${var.instance_bucket_arn}",
        "${var.instance_bucket_arn}/*",
        "${var.history_bucket_arn}",
        "${var.history_bucket_arn}/*"
      ]
    }]
  })
}

# DynamoDB permissions for task role
resource "aws_iam_role_policy" "ecs_task_dynamodb" {
  name = "${var.name_prefix}-ecs-task-dynamodb"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = [
        "${var.interviews_table_arn}",
        "${var.interviews_table_arn}/*",
        "${var.operations_table_arn}",
        "${var.operations_table_arn}/*",
        "${var.challenges_table_arn}",
        "${var.challenges_table_arn}/*"
      ]
    }]
  })
}

# ECS Execute Command permissions (for SSM)
resource "aws_iam_role_policy" "ecs_task_ssm_exec" {
  name = "${var.name_prefix}-ecs-task-ssm-exec"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:ExecuteCommand",
          "ecs:DescribeTasks"
        ]
        Resource = "*"
      }
    ]
  })
}

# Terraform state access (for portal to create interviews)
resource "aws_iam_role_policy" "ecs_task_terraform_state" {
  name = "${var.name_prefix}-ecs-task-terraform-state"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.terraform_state_bucket}/*",
          "arn:aws:s3:::${var.project_prefix}-${var.environment}-terraform-state/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.terraform_state_bucket}",
          "arn:aws:s3:::${var.project_prefix}-${var.environment}-terraform-state"
        ]
      }
    ]
  })
}

# ECS and EC2 permissions (for portal to manage ECS services)
resource "aws_iam_role_policy" "ecs_task_ecs_permissions" {
  name = "${var.name_prefix}-ecs-task-ecs-permissions"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:*",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "elasticloadbalancing:*",
          "route53:*",
          "acm:DescribeCertificate",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.ecs_task_role.arn,
          aws_iam_role.ecs_execution_role.arn
        ]
      }
    ]
  })
}
