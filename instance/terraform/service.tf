resource "aws_ssm_parameter" "interview_password" {
  name  = "/prequel/interviews/${local.interview_id}/password"
  type  = "SecureString"
  value = var.password

  tags = local.tags
}

# Custom code-server ECR repository
data "aws_ecr_repository" "code_server" {
  name = "prequel-dev-code-server"
}


# ECS Task Definition for the interview instance
resource "aws_ecs_task_definition" "interview" {
  family             = local.service_name
  network_mode       = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                = 1024
  memory             = 2048
  execution_role_arn = data.terraform_remote_state.infrastructure.outputs.ecs_execution_role_arn
  task_role_arn      = data.terraform_remote_state.infrastructure.outputs.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name  = "code-server"
      image = "${data.aws_ecr_repository.code_server.repository_url}:latest"

      portMappings = [
        {
          containerPort = 8443
          hostPort      = 8443
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "SCENARIO"
          value = var.scenario
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
          "awslogs-group"         = data.terraform_remote_state.infrastructure.outputs.cloudwatch_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "interview-${local.interview_id}"
        }
      }

      essential = true
    }
  ])


  tags = local.tags
}


# ALB Target Group for this interview instance
resource "aws_lb_target_group" "interview" {
  name = substr(local.service_name, 0, 32)
  port        = 8443
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.infrastructure.outputs.vpc_id
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

  tags = local.tags
}

# ALB Listener Rule for this interview instance
resource "aws_lb_listener_rule" "interview" {
  listener_arn = data.terraform_remote_state.infrastructure.outputs.alb_https_listener_arn
  priority     = 100 + (sum([
    for i, c in split("", substr(local.interview_id, 0, 4)) :
    (pow(16, 3 - i) * index(split("", "0123456789abcdef"), lower(c)))
  ]) % 49800)


  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.interview.arn
  }

  condition {
    host_header {
      values = ["${local.interview_id}.${data.terraform_remote_state.infrastructure.outputs.domain_name}"]
    }
  }

  tags = local.tags
}

# Individual ECS service for this interview
resource "aws_ecs_service" "interview" {
  name            = local.service_name
  cluster         = data.terraform_remote_state.infrastructure.outputs.ecs_cluster_name
  task_definition = aws_ecs_task_definition.interview.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.infrastructure.outputs.private_subnet_ids
    security_groups = [data.terraform_remote_state.infrastructure.outputs.code_server_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.interview.arn
    container_name   = "code-server"
    container_port   = 8443
  }

  depends_on = [aws_lb_listener_rule.interview]

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}

