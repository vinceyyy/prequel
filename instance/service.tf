resource "aws_ssm_parameter" "interview_password" {
  name  = "/prequel/interviews/${local.interview_id}/password"
  type  = "SecureString"
  value = var.password

  tags = local.tags
}

# Per-interview EFS file system
resource "aws_efs_file_system" "interview" {
  creation_token = "${local.service_name}-efs"
  encrypted      = true

  performance_mode = "generalPurpose"
  throughput_mode  = "provisioned"
  provisioned_throughput_in_mibps = 10

  tags = merge(local.tags, {
    Name = "${local.service_name}-efs"
    InterviewId = local.interview_id
    Scenario = var.scenario
  })
}

resource "aws_efs_mount_target" "interview" {
  count = length(data.terraform_remote_state.infrastructure.outputs.private_subnet_ids)

  file_system_id  = aws_efs_file_system.interview.id
  subnet_id       = data.terraform_remote_state.infrastructure.outputs.private_subnet_ids[count.index]
  security_groups = [data.terraform_remote_state.infrastructure.outputs.efs_security_group_id]
}

resource "aws_efs_access_point" "interview" {
  file_system_id = aws_efs_file_system.interview.id

  root_directory {
    path = "/workspace"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = 755
    }
  }

  posix_user {
    gid = 1000
    uid = 1000
  }

  tags = merge(local.tags, {
    Name = "${local.service_name}-access-point"
    InterviewId = local.interview_id
    Scenario = var.scenario
  })
}

# EFS initialization is handled by the container itself during startup
# The container will download scenario files from S3 to the EFS mount
# This approach is simpler and more reliable than Lambda-based initialization

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
      image = "lscr.io/linuxserver/code-server:latest"

      portMappings = [
        {
          containerPort = 8443
          hostPort      = 8443
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "PUID"
          value = "1000"
        },
        {
          name  = "PGID"
          value = "1000"
        },
        {
          name  = "TZ"
          value = "UTC"
        },
        {
          name  = "DEFAULT_WORKSPACE"
          value = "/config/workspace"
        },
        {
          name  = "PROXY_DOMAIN"
          value = "${data.terraform_remote_state.infrastructure.outputs.alb_dns_name}/interview-${local.interview_id}"
        },
        {
          name  = "INTERVIEW_ID"
          value = local.interview_id
        },
        {
          name  = "CANDIDATE_NAME"
          value = var.candidate_name
        },
        {
          name  = "SCENARIO"
          value = var.scenario
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "S3_BUCKET"
          value = "prequel-instance"
        },
        {
          name  = "INIT_EFS"
          value = "true"
        },
        {
          name  = "SUBFOLDER"
          value = "/interview-${local.interview_id}"
        },
      ]

      mountPoints = [
        {
          sourceVolume  = "scenario-files"
          containerPath = "/config/workspace"
          readOnly      = false
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

  volume {
    name = "scenario-files"

    efs_volume_configuration {
      file_system_id          = aws_efs_file_system.interview.id
      root_directory          = "/"
      transit_encryption      = "ENABLED"
      transit_encryption_port = 2049
      authorization_config {
        access_point_id = aws_efs_access_point.interview.id
        iam             = "ENABLED"
      }
    }
  }

  tags = local.tags
}

# Target group for this interview instance
resource "aws_lb_target_group" "interview" {
  name     = local.service_name
  port     = 8443
  protocol = "HTTP"
  vpc_id   = data.terraform_remote_state.infrastructure.outputs.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/healthz"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 10
    unhealthy_threshold = 3
  }

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

# Load balancer listener rules for HTTP
resource "aws_lb_listener_rule" "interview" {
  listener_arn = data.terraform_remote_state.infrastructure.outputs.alb_listener_arn
  priority     = 100 + (sum([for i, c in split("", substr(local.interview_id, 0, 4)) : (pow(16, 3 - i) * index(split("", "0123456789abcdef"), lower(c)))]) % 49800)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.interview.arn
  }

  condition {
    path_pattern {
      values = ["/interview-${local.interview_id}", "/interview-${local.interview_id}/*"]
    }
  }
}

# Load balancer listener rules for HTTPS
resource "aws_lb_listener_rule" "interview_https" {
  count = data.terraform_remote_state.infrastructure.outputs.alb_https_listener_arn != null ? 1 : 0

  listener_arn = data.terraform_remote_state.infrastructure.outputs.alb_https_listener_arn
  priority     = 200 + (sum([for i, c in split("", substr(local.interview_id, 0, 4)) : (pow(16, 3 - i) * index(split("", "0123456789abcdef"), lower(c)))]) % 49800)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.interview.arn
  }

  condition {
    path_pattern {
      values = ["/interview-${local.interview_id}", "/interview-${local.interview_id}/*"]
    }
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
    subnets          = data.terraform_remote_state.infrastructure.outputs.private_subnet_ids
    security_groups  = [data.terraform_remote_state.infrastructure.outputs.code_server_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.interview.arn
    container_name   = "code-server"
    container_port   = 8443
  }

  depends_on = [aws_lb_listener_rule.interview, aws_efs_mount_target.interview]

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}