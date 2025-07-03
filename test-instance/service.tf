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
  family                   = local.service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = data.terraform_remote_state.infrastructure.outputs.ecs_execution_role_arn
  task_role_arn           = data.terraform_remote_state.infrastructure.outputs.ecs_task_role_arn

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


# Security group for direct internet access
resource "aws_security_group" "code_server_direct" {
  name_prefix = "interview-${local.interview_id}-"
  vpc_id      = data.terraform_remote_state.infrastructure.outputs.vpc_id

  ingress {
    description = "Code Server from Internet"
    from_port   = 8443
    to_port     = 8443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.service_name}-direct-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Individual ECS service for this interview
resource "aws_ecs_service" "interview" {
  name            = local.service_name
  cluster         = data.terraform_remote_state.infrastructure.outputs.ecs_cluster_name
  task_definition = aws_ecs_task_definition.interview.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.infrastructure.outputs.public_subnet_ids
    security_groups  = [aws_security_group.code_server_direct.id]
    assign_public_ip = true
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}

