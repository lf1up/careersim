data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = merge(var.tags, {
    Project     = var.project,
    Environment = var.environment
  })
}

# Reuse existing VPC if provided, otherwise create a small new one
module "network" {
  count  = var.vpc_id == null ? 1 : 0
  source = "../aws/modules/network"

  project              = var.project
  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  enable_nat_gateway   = false
  tags                 = local.common_tags
}

locals {
  selected_vpc_id             = var.vpc_id != null ? var.vpc_id : module.network[0].vpc_id
  selected_public_subnet_ids  = var.vpc_id != null ? var.public_subnet_ids : module.network[0].public_subnet_ids
  selected_private_subnet_ids = var.vpc_id != null ? var.private_subnet_ids : module.network[0].private_subnet_ids
}

# Security groups (ALB open to world, Services allow 8001 from ALB and self)
resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "ALB security group"
  vpc_id      = local.selected_vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-alb-sg" })
}

resource "aws_security_group" "services" {
  name        = "${local.name_prefix}-services-sg"
  description = "ECS services security group"
  vpc_id      = local.selected_vpc_id

  # Allow inbound from ALB on transformers port 8001
  ingress {
    from_port       = 8001
    to_port         = 8001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "ALB to transformers"
  }

  # Allow self traffic for service discovery/future
  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    self      = true
    description = "Inter-service traffic"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-services-sg" })
}

# ECS cluster
resource "aws_ecs_cluster" "this" {
  name = "${local.name_prefix}-ecs"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.common_tags
}

# CloudWatch log group
resource "aws_cloudwatch_log_group" "transformers" {
  name              = "/ecs/${local.name_prefix}-transformers"
  retention_in_days = 14
  tags              = local.common_tags
}

# === GPU EC2 capacity (single g4dn.xlarge) ===
# ECS GPU-optimized AMI
data "aws_ssm_parameter" "ecs_gpu_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/gpu/recommended/image_id"
}

# Security group for ECS container instances (EC2 hosts)
resource "aws_security_group" "ecs_instances" {
  name        = "${local.name_prefix}-ecs-instances-sg"
  description = "Security group for ECS EC2 container instances"
  vpc_id      = local.selected_vpc_id

  # Optional SSH from a specific CIDR
  dynamic "ingress" {
    for_each = var.ssh_ingress_cidr == null ? [] : [var.ssh_ingress_cidr]
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
      description = "Optional SSH access"
    }
  }

  ingress {
    from_port       = 8001
    to_port         = 8001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "ALB to instance on 8001"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-ecs-instances-sg" })
}

# IAM role for ECS container instances
data "aws_iam_policy_document" "ecs_instance_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_instance" {
  name               = "${local.name_prefix}-ecs-instance"
  assume_role_policy = data.aws_iam_policy_document.ecs_instance_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_instance_base" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ssm" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ecr" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "ecs_instance" {
  name = "${local.name_prefix}-ecs-instance-profile"
  role = aws_iam_role.ecs_instance.name
}

# Launch template for a single g4dn.xlarge GPU instance joined to the ECS cluster
resource "aws_launch_template" "ecs_gpu" {
  name_prefix   = "${local.name_prefix}-gpu-"
  image_id      = data.aws_ssm_parameter.ecs_gpu_ami.value
  instance_type = "g4dn.xlarge"
  key_name      = var.key_name

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance.name
  }

  vpc_security_group_ids = [aws_security_group.ecs_instances.id]

  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo "ECS_CLUSTER=${aws_ecs_cluster.this.name}" >> /etc/ecs/ecs.config
    echo "ECS_ENABLE_GPU_SUPPORT=true" >> /etc/ecs/ecs.config
    yum install -y amazon-ssm-agent || true
    systemctl enable amazon-ssm-agent || true
    systemctl start amazon-ssm-agent || true
    # Ensure Docker and ECR auth for large image pull
    yum install -y docker awscli || true
    systemctl enable docker || true
    systemctl start docker || true
    eval $(aws ecr get-login --no-include-email --region ${data.aws_region.current.id}) || true
    docker pull ${var.container_image_transformers} || true
  EOF
  )

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.root_volume_size
      volume_type           = "gp3"
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags          = local.common_tags
  }

  tag_specifications {
    resource_type = "volume"
    tags          = local.common_tags
  }

  tags = local.common_tags
}

resource "aws_autoscaling_group" "ecs_gpu" {
  name                      = "${local.name_prefix}-gpu-asg"
  min_size                  = 1
  max_size                  = 1
  desired_capacity          = 1
  vpc_zone_identifier       = local.selected_public_subnet_ids
  health_check_type         = "EC2"
  force_delete              = false
  capacity_rebalance        = false

  launch_template {
    id      = aws_launch_template.ecs_gpu.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-gpu"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = local.common_tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

resource "aws_ecs_capacity_provider" "gpu" {
  name = "${local.name_prefix}-gpu-cp"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs_gpu.arn
    managed_termination_protection = "DISABLED"

    managed_scaling {
      status = "DISABLED"
    }
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name = aws_ecs_cluster.this.name
  capacity_providers = [aws_ecs_capacity_provider.gpu.name]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.gpu.name
    weight            = 1
    base              = 1
  }
}

# IAM roles (execution + task)
data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_exec_policy" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy" "ecs_task_inline" {
  name = "${local.name_prefix}-ecs-task-inline"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "ssm:GetParameters",
          "ssm:GetParameter",
          "secretsmanager:GetSecretValue",
          "kms:Decrypt"
        ],
        Resource = "*"
      }
    ]
  })
}

# Task definition
resource "aws_ecs_task_definition" "transformers" {
  family                   = "${local.name_prefix}-transformers"
  network_mode             = "bridge"
  requires_compatibilities = ["EC2"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "transformers"
      image     = var.container_image_transformers
      essential = true
      cpu       = 1024
      memory    = 2048
      portMappings = [{ containerPort = 8001, hostPort = 8001, protocol = "tcp" }]
      resourceRequirements = [
        { type = "GPU", value = "1" }
      ]
      environment = [
        { name = "AUTH_TOKEN", value = var.transformers_auth_token },
        { name = "AUTH_REQUIRED", value = "true" },
        { name = "TRANSFORMERS_CACHE", value = "/app/models_cache" },
        { name = "HF_HOME", value = "/app/models_cache" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.transformers.name
          awslogs-region        = data.aws_region.current.id
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
  tags = local.common_tags
}

# Service
resource "aws_ecs_service" "transformers" {
  name            = "${local.name_prefix}-transformers"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.transformers.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.gpu.name
    weight            = 1
  }

  placement_constraints {
    type       = "memberOf"
    expression = "attribute:ecs.instance-type == g4dn.xlarge"
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.transformers.arn
    container_name   = "transformers"
    container_port   = 8001
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  propagate_tags                     = "SERVICE"
  tags = local.common_tags
}

# ALB and related
resource "aws_lb" "this" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.selected_public_subnet_ids
  tags               = local.common_tags
}

resource "aws_lb_target_group" "transformers" {
  name        = "${local.name_prefix}-tg"
  port        = 8001
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = local.selected_vpc_id
  health_check {
    enabled             = true
    path                = "/"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
  tags = local.common_tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.transformers.arn
  }
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}


