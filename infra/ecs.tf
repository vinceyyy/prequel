resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_ssm" {
  name = "${local.name}-ecs-execution-ssm-policy"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:*:parameter/${local.name}/*",
          "arn:aws:ssm:${var.aws_region}:*:parameter/prequel/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "ecs_task_s3_scenarios" {
  name = "${local.name}-ecs-task-s3-scenarios-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.scenarios.arn,
          "${aws_s3_bucket.scenarios.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "code_server" {
  name              = "/ecs/${local.name}/code-server"
  retention_in_days = 7

  tags = local.tags
}

resource "aws_ecs_task_definition" "code_server" {
  family                   = "${local.name}-code-server"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.code_server_cpu
  memory                   = var.code_server_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "code-server"
      image = var.code_server_image

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
        }
      ]

      secrets = [
        {
          name      = "PASSWORD"
          valueFrom = aws_ssm_parameter.default_password.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.code_server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      essential = true
    }
  ])

  tags = local.tags
}

resource "aws_ssm_parameter" "default_password" {
  name  = "/${local.name}/code-server/default-password"
  type  = "SecureString"
  value = "ChangeMe123!"

  tags = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# Portal ECS resources
resource "aws_cloudwatch_log_group" "portal" {
  name              = "/ecs/${local.name}/portal"
  retention_in_days = 7

  tags = local.tags
}

resource "aws_iam_role" "portal_task" {
  name = "${local.name}-portal-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "portal_task" {
  name = "${local.name}-portal-task-policy"
  role = aws_iam_role.portal_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:*",
          "elasticloadbalancing:*",
          "route53:*",
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:AddTagsToResource",
          "ssm:DescribeParameters",
          "ssm:ListTagsForResource",
          "elasticfilesystem:*",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeAvailabilityZones",
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:AttachNetworkInterface",
          "ec2:DetachNetworkInterface",
          "ec2:ModifyNetworkInterfaceAttribute",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceTypes",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateTags",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:GetRepositoryPolicy",
          "ecr:ListTagsForResource"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.ecs_task.arn,
          aws_iam_role.ecs_execution.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:GetBucketVersioning"
        ]
        Resource = [
          "arn:aws:s3:::prequel-terraform-state",
          aws_s3_bucket.instance_code.arn,
          aws_s3_bucket.scenarios.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion",
          "s3:ListObjectsV2"
        ]
        Resource = [
          "arn:aws:s3:::prequel-terraform-state/*",
          "${aws_s3_bucket.instance_code.arn}/*",
          "${aws_s3_bucket.scenarios.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_ecs_task_definition" "portal" {
  family                   = "${local.name}-portal"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 4096
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.portal_task.arn

  container_definitions = jsonencode([
    {
      name  = "portal"
      image = "${aws_ecr_repository.portal.repository_url}:latest"

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.portal.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      essential = true
    }
  ])

  tags = local.tags
}

resource "aws_ecs_service" "portal" {
  name            = "${local.name}-portal"
  cluster         = aws_ecs_cluster.main.name
  task_definition = aws_ecs_task_definition.portal.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.portal.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.portal.arn
    container_name   = "portal"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https]

  tags = local.tags

  lifecycle {
    ignore_changes = [desired_count]
  }
}