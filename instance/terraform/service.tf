resource "aws_ssm_parameter" "interview_password" {
  name  = "/${data.terraform_remote_state.common.outputs.project_prefix}/interviews/${local.interview_id}/password"
  type  = "SecureString"
  value = var.password

  tags = local.tags
}

# Use the code-server ECR repository from infrastructure
# (No data source needed - using repository_url from remote state)

# Security group for the interview ALB
resource "aws_security_group" "interview_alb" {
  name        = "${local.service_name}-alb"
  description = "Security group for interview ALB"
  vpc_id      = data.terraform_remote_state.common.outputs.vpc_id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.service_name}-alb-sg"
  })
}

# Security group for the interview ECS tasks
resource "aws_security_group" "interview_ecs" {
  name        = "${local.service_name}-ecs"
  description = "Security group for interview ECS tasks"
  vpc_id      = data.terraform_remote_state.common.outputs.vpc_id

  ingress {
    description     = "Code Server from interview ALB"
    from_port       = 8443
    to_port         = 8443
    protocol        = "tcp"
    security_groups = [aws_security_group.interview_alb.id]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.service_name}-ecs-sg"
  })
}

# Dedicated ALB for this interview instance
resource "aws_lb" "interview" {
  name = substr("${local.service_name}-alb", 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups = [aws_security_group.interview_alb.id]
  subnets            = data.terraform_remote_state.common.outputs.public_subnet_ids

  enable_deletion_protection = false

  tags = merge(local.tags, {
    Name = "${local.service_name}-alb"
  })
}

# Target Group for this interview instance
resource "aws_lb_target_group" "interview" {
  name = substr("${local.service_name}-tg", 0, 32)
  port        = 8443
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.common.outputs.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200-302"
    path                = "/healthz"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 10
    unhealthy_threshold = 3
  }

  tags = merge(local.tags, {
    Name = "${local.service_name}-tg"
  })
}

# HTTP Listener (redirect to HTTPS)
resource "aws_lb_listener" "interview_http" {
  load_balancer_arn = aws_lb.interview.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = data.terraform_remote_state.common.outputs.domain_name != "" ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = data.terraform_remote_state.common.outputs.domain_name != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "forward" {
      for_each = data.terraform_remote_state.common.outputs.domain_name == "" ? [1] : []
      content {
        target_group {
          arn = aws_lb_target_group.interview.arn
        }
      }
    }
  }

  tags = local.tags
}

# HTTPS Listener (if domain is configured)
resource "aws_lb_listener" "interview_https" {
  count = data.terraform_remote_state.common.outputs.domain_name != "" ? 1 : 0

  load_balancer_arn = aws_lb.interview.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = data.terraform_remote_state.common.outputs.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.interview.arn
  }

  tags = local.tags
}

# Route53 record for the subdomain
resource "aws_route53_record" "interview" {
  count = data.terraform_remote_state.common.outputs.domain_name != "" ? 1 : 0

  zone_id = data.terraform_remote_state.common.outputs.route53_zone_id
  name    = "${local.interview_id}.${data.terraform_remote_state.common.outputs.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.interview.dns_name
    zone_id                = aws_lb.interview.zone_id
    evaluate_target_health = true
  }
}

# ECS Task Definition for the interview instance
resource "aws_ecs_task_definition" "interview" {
  family             = local.service_name
  network_mode       = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                = 1024
  memory             = 2048
  execution_role_arn = data.terraform_remote_state.common.outputs.ecs_execution_role_arn
  task_role_arn      = data.terraform_remote_state.common.outputs.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name  = "code-server"
      image = "${data.terraform_remote_state.common.outputs.code_server_ecr_repository_url}:latest"

      portMappings = [
        {
          containerPort = 8443
          hostPort      = 8443
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "CHALLENGE"
          value = var.challenge
        },
        {
          name  = "S3_CHALLENGE_BUCKET"
          value = data.terraform_remote_state.common.outputs.challenge_bucket_name
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "OPENAI_API_KEY"
          value = var.openai_api_key
        }
      ]

      secrets = [
        {
          name      = "PASSWORD"
          valueFrom = aws_ssm_parameter.interview_password.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = data.terraform_remote_state.common.outputs.cloudwatch_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "interview-${local.interview_id}"
        }
      }

      essential = true
    }
  ])

  tags = local.tags
}

# Individual ECS service for this interview
resource "aws_ecs_service" "interview" {
  name            = local.service_name
  cluster         = data.terraform_remote_state.common.outputs.ecs_cluster_name
  task_definition = aws_ecs_task_definition.interview.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  health_check_grace_period_seconds = 300

  network_configuration {
    subnets          = data.terraform_remote_state.common.outputs.private_subnet_ids
    security_groups  = [aws_security_group.interview_ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.interview.arn
    container_name   = "code-server"
    container_port   = 8443
  }

  depends_on = [
    aws_lb_listener.interview_http,
    aws_lb_listener.interview_https
  ]

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}