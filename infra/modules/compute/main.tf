# infra/modules/compute/main.tf

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ECR Repositories
resource "aws_ecr_repository" "portal" {
  name                 = "${var.name_prefix}-portal"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = false
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "portal" {
  repository = aws_ecr_repository.portal.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = {
        type = "expire"
      }
    }]
  })
}

resource "aws_ecr_repository" "code_server" {
  name                 = "${var.name_prefix}-code-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = false
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "code_server" {
  repository = aws_ecr_repository.code_server.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "portal" {
  name              = "/ecs/${var.name_prefix}-portal"
  retention_in_days = 7

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "interview" {
  name              = "/ecs/${var.name_prefix}-interview"
  retention_in_days = 7

  tags = var.tags
}

# Portal ECS Task Definition
resource "aws_ecs_task_definition" "portal" {
  family                   = "${var.name_prefix}-portal"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([{
    name      = "portal"
    image     = "${aws_ecr_repository.portal.repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "AWS_REGION", value = var.aws_region },
      { name = "PROJECT_PREFIX", value = var.project_prefix },
      { name = "ENVIRONMENT", value = var.environment },
      { name = "DOMAIN_NAME", value = var.domain_name },
      { name = "ENABLE_AUTH", value = tostring(var.enable_auth) },
      { name = "AUTH_PASSCODE", value = var.auth_passcode },
      { name = "OPENAI_ADMIN_KEY", value = var.openai_admin_key },
      { name = "OPENAI_PROJECT_ID", value = var.openai_project_id },
      { name = "LOG_LEVEL", value = var.log_level },
      { name = "TERRAFORM_STATE_BUCKET", value = var.terraform_state_bucket }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.portal.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "portal"
      }
    }
  }])

  tags = var.tags
}

# Portal Security Group
resource "aws_security_group" "portal" {
  name_prefix = "${var.name_prefix}-portal-"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Portal from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-portal-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Portal ECS Service
resource "aws_ecs_service" "portal" {
  name            = "${var.name_prefix}-portal"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.portal.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  enable_execute_command = true

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.portal.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.portal.arn
    container_name   = "portal"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]

  tags = var.tags
}
