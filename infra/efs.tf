# EFS Security Group - used by per-interview EFS volumes
resource "aws_security_group" "efs" {
  name_prefix = "${local.name}-efs-"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "NFS from ECS"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.code_server.id, aws_security_group.portal.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.name}-efs-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Per-interview EFS volumes are created by the interview-instances terraform template
# Each interview gets its own fresh EFS volume populated with scenario files