resource "aws_ssm_parameter" "interview_password" {
  name  = "/${data.terraform_remote_state.common.outputs.project_prefix}/interviews/${local.interview_id}/password"
  type  = "SecureString"
  value = var.password

  tags = local.tags
}

# Random integer for ALB listener rule priority
# Each interview needs a unique priority (100-50000)
resource "random_integer" "priority" {
  min = 100
  max = 50000
}

# Security group for the interview ECS tasks
resource "aws_security_group" "interview_ecs" {
  name        = "${local.service_name}-ecs"
  description = "Security group for interview ECS tasks"
  vpc_id      = data.terraform_remote_state.common.outputs.vpc_id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 8443
    to_port         = 8443
    protocol        = "tcp"
    security_groups = [data.terraform_remote_state.common.outputs.alb_security_group_id]
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

# Target Group for this interview instance (points to shared ALB)
resource "aws_lb_target_group" "interview" {
  name        = substr("${local.service_name}-tg", 0, 32)
  port        = 8443
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.common.outputs.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/healthz"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }

  tags = merge(local.tags, {
    Name = "${local.service_name}-tg"
  })
}

# ALB Listener Rule for host-based routing (only if domain is configured)
resource "aws_lb_listener_rule" "interview" {
  count        = data.terraform_remote_state.common.outputs.domain_name != "" ? 1 : 0
  listener_arn = data.terraform_remote_state.common.outputs.alb_https_listener_arn
  priority     = random_integer.priority.result

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.interview.arn
  }

  condition {
    host_header {
      values = ["${local.interview_id}.${data.terraform_remote_state.common.outputs.domain_name}"]
    }
  }

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

# Route53 record for the subdomain (points to shared ALB)
resource "aws_route53_record" "interview" {
  count   = data.terraform_remote_state.common.outputs.domain_name != "" ? 1 : 0
  zone_id = data.terraform_remote_state.common.outputs.route53_zone_id
  name    = "${local.interview_id}.${data.terraform_remote_state.common.outputs.domain_name}"
  type    = "A"

  alias {
    name                   = data.terraform_remote_state.common.outputs.alb_dns_name
    zone_id                = data.terraform_remote_state.common.outputs.alb_zone_id
    evaluate_target_health = true
  }
}

# ECS Task Definition for the interview instance
resource "aws_ecs_task_definition" "interview" {
  family                   = local.service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = data.terraform_remote_state.common.outputs.ecs_execution_role_arn
  task_role_arn            = data.terraform_remote_state.common.outputs.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "code-server"
      image     = "${data.terraform_remote_state.common.outputs.code_server_ecr_repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        {
          containerPort = 8443
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "CHALLENGE_BUCKET"
          value = data.terraform_remote_state.common.outputs.challenge_bucket_name
        },
        {
          name  = "CHALLENGE_KEY"
          value = var.challenge
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "CANDIDATE_NAME"
          value = var.candidate_name
        },
        {
          name  = "INTERVIEW_ID"
          value = local.interview_id
        },
        {
          name  = "OPENAI_API_KEY"
          value = openai_project_service_account.account.api_key
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
          "awslogs-group"         = data.terraform_remote_state.common.outputs.interview_cloudwatch_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "interview-${local.interview_id}"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8443/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

# ECS Service for the interview instance
resource "aws_ecs_service" "interview" {
  name            = local.service_name
  cluster         = data.terraform_remote_state.common.outputs.ecs_cluster_arn
  task_definition = aws_ecs_task_definition.interview.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  enable_execute_command = true

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
    aws_lb_target_group.interview,
    aws_lb_listener_rule.interview
  ]

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}