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

# ECS Task to populate EFS with scenario files
resource "aws_ecs_task_definition" "efs_init" {
  family                   = "${local.service_name}-init"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = data.terraform_remote_state.infrastructure.outputs.ecs_execution_role_arn
  task_role_arn            = data.terraform_remote_state.infrastructure.outputs.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name  = "efs-init"
      image = data.terraform_remote_state.infrastructure.outputs.ecr_repository_url
      
      environment = [
        {
          name  = "INIT_MODE"
          value = "true"
        },
        {
          name  = "SCENARIO"
          value = var.scenario
        }
      ]

      mountPoints = [
        {
          sourceVolume  = "scenario-files"
          containerPath = "/workspace"
          readOnly      = false
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = data.terraform_remote_state.infrastructure.outputs.cloudwatch_log_group_name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "init-${local.interview_id}"
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

# Run the EFS initialization task
resource "null_resource" "efs_init" {
  depends_on = [aws_efs_mount_target.interview]

  provisioner "local-exec" {
    interpreter = ["sh", "-c"]
    command = <<-EOT
      set -e
      echo "Starting EFS initialization task..."
      
      # Run the task and extract the task ARN directly
      TASK_ARN=$(aws ecs run-task \
        --cluster ${data.terraform_remote_state.infrastructure.outputs.ecs_cluster_name} \
        --task-definition ${aws_ecs_task_definition.efs_init.arn} \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[${join(",", data.terraform_remote_state.infrastructure.outputs.private_subnet_ids)}],securityGroups=[${data.terraform_remote_state.infrastructure.outputs.code_server_security_group_id}],assignPublicIp=DISABLED}" \
        --region ${var.aws_region} \
        --query 'tasks[0].taskArn' \
        --output text)
      
      echo "Started task: $TASK_ARN"
      
      # Validate that we got a task ARN
      if [ "$TASK_ARN" = "None" ] || [ -z "$TASK_ARN" ]; then
        echo "Error: Failed to start ECS task"
        exit 1
      fi
      
      # Wait for the task to complete
      echo "Waiting for task to complete..."
      aws ecs wait tasks-stopped \
        --cluster ${data.terraform_remote_state.infrastructure.outputs.ecs_cluster_name} \
        --tasks "$TASK_ARN" \
        --region ${var.aws_region}
      
      echo "Task completed: $TASK_ARN"
    EOT
  }

  triggers = {
    efs_id = aws_efs_file_system.interview.id
    scenario = var.scenario
  }
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
        }
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
    path                = "/"
    port                = "traffic-port"
    protocol            = "HTTPS"
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
  priority     = 200 + (sum([for i, c in split("", substr(local.interview_id, 0, 4)) : (pow(16, 3 - i) * index(split("", "0123456789abcdef"), lower(c)))]) % 49800)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.interview.arn
  }

  condition {
    path_pattern {
      values = ["/interview-${local.interview_id}/*"]
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
      values = ["/interview-${local.interview_id}/*"]
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

  depends_on = [aws_lb_listener_rule.interview, null_resource.efs_init]

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}