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

# resource "aws_efs_mount_target" "interview" {
#   count = length(data.terraform_remote_state.infrastructure.outputs.private_subnet_ids)
#
#   file_system_id  = aws_efs_file_system.interview.id
#   subnet_id       = data.terraform_remote_state.infrastructure.outputs.private_subnet_ids[count.index]
#   security_groups = [data.terraform_remote_state.infrastructure.outputs.efs_security_group_id]
# }
#
# resource "aws_efs_access_point" "interview" {
#   file_system_id = aws_efs_file_system.interview.id
#
#   root_directory {
#     path = "/workspace"
#     creation_info {
#       owner_gid   = 1000
#       owner_uid   = 1000
#       permissions = 755
#     }
#   }
#
#   posix_user {
#     gid = 1000
#     uid = 1000
#   }
#
#   tags = merge(local.tags, {
#     Name = "${local.service_name}-access-point"
#     InterviewId = local.interview_id
#     Scenario = var.scenario
#   })
# }

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
      ]

      # mountPoints = [
      #   {
      #     sourceVolume  = "scenario-files"
      #     containerPath = "/workspace"
      #     readOnly      = false
      #   }
      # ]

      # secrets = [
      #   {
      #     name      = "PASSWORD"
      #     valueFrom = aws_ssm_parameter.interview_password.arn
      #   }
      # ]

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

  # volume {
  #   name = "scenario-files"
  #
  #   efs_volume_configuration {
  #     file_system_id          = aws_efs_file_system.interview.id
  #     root_directory          = "/"
  #     transit_encryption      = "ENABLED"
  #     transit_encryption_port = 2049
  #     authorization_config {
  #       access_point_id = aws_efs_access_point.interview.id
  #       iam             = "ENABLED"
  #     }
  #   }
  # }

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

