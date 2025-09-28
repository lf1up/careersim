locals {
  name_prefix = "${var.project}-${var.environment}"
}

# CloudWatch Logs
resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name_prefix}-backend"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "rag" {
  count             = var.enable_rag_service ? 1 : 0
  name              = "/ecs/${local.name_prefix}-rag"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "transformers" {
  count             = var.enable_transformers_service ? 1 : 0
  name              = "/ecs/${local.name_prefix}-transformers"
  retention_in_days = 30
  tags              = var.tags
}

# ECS Cluster
resource "aws_ecs_cluster" "this" {
  name = "${local.name_prefix}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}

# Optional EC2 GPU capacity provider for Transformers
data "aws_ssm_parameter" "ecs_gpu_ami" {
  count = var.transformers_use_gpu ? 1 : 0
  name  = "/aws/service/ecs/optimized-ami/amazon-linux-2/gpu/recommended/image_id"
}

resource "aws_iam_role" "ecs_instance_role" {
  count              = var.transformers_use_gpu ? 1 : 0
  name               = "${local.name_prefix}-ecs-instance-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "ec2.amazonaws.com" },
      Action   = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_instance_managed" {
  count      = var.transformers_use_gpu ? 1 : 0
  role       = aws_iam_role.ecs_instance_role[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "ecs_instance_profile" {
  count = var.transformers_use_gpu ? 1 : 0
  name  = "${local.name_prefix}-ecs-instance-profile"
  role  = aws_iam_role.ecs_instance_role[0].name
}

resource "aws_launch_template" "gpu" {
  count         = var.transformers_use_gpu ? 1 : 0
  name_prefix   = "${local.name_prefix}-gpu-"
  image_id      = data.aws_ssm_parameter.ecs_gpu_ami[0].value
  instance_type = var.gpu_instance_type
  iam_instance_profile { name = aws_iam_instance_profile.ecs_instance_profile[0].name }
  user_data = base64encode(<<-EOT
              #!/bin/bash
              echo ECS_CLUSTER=${aws_ecs_cluster.this.name} >> /etc/ecs/ecs.config
              EOT
  )
  network_interfaces {
    security_groups = [var.services_sg_id]
  }
  tag_specifications {
    resource_type = "instance"
    tags          = var.tags
  }
}

resource "aws_autoscaling_group" "gpu" {
  count               = var.transformers_use_gpu ? 1 : 0
  name                = "${local.name_prefix}-gpu-asg"
  max_size            = var.gpu_asg_max
  min_size            = var.gpu_asg_min
  desired_capacity    = var.gpu_asg_desired
  vpc_zone_identifier = var.private_subnet_ids
  launch_template {
    id      = aws_launch_template.gpu[0].id
    version = "$Latest"
  }
  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-gpu"
    propagate_at_launch = true
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_ecs_capacity_provider" "gpu" {
  count = var.transformers_use_gpu ? 1 : 0
  name  = "${local.name_prefix}-gpu-cp"
  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.gpu[0].arn
    managed_termination_protection = "ENABLED"
    managed_scaling {
      status          = "ENABLED"
      target_capacity = 80
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  count          = var.transformers_use_gpu ? 1 : 0
  cluster_name   = aws_ecs_cluster.this.name
  capacity_providers = [
    aws_ecs_capacity_provider.gpu[0].name,
    "FARGATE",
    "FARGATE_SPOT"
  ]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# Cloud Map namespace for service discovery
resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "local"
  vpc         = var.vpc_id
  description = "Private namespace for internal services"
  tags        = var.tags
}

# ALB
resource "aws_lb" "this" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids
  tags               = var.tags
}

resource "aws_lb_target_group" "backend" {
  name     = "${local.name_prefix}-tg"
  port     = 8000
  protocol = "HTTP"
  target_type = "ip"
  vpc_id   = var.vpc_id
  health_check {
    enabled             = true
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
  tags = var.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

# EFS Access Point for uploads
resource "aws_efs_access_point" "uploads" {
  file_system_id = var.efs_id
  posix_user {
    uid = 1001
    gid = 1001
  }
  root_directory {
    path = "/uploads"
    creation_info {
      owner_gid   = 1001
      owner_uid   = 1001
      permissions = "0775"
    }
  }
  tags = var.tags
}

# Task Definitions
resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "4096"
  execution_role_arn       = module.security_output_dummy.execution_role_arn
  task_role_arn            = module.security_output_dummy.task_role_arn

  volume {
    name = "uploads"
    efs_volume_configuration {
      file_system_id          = var.efs_id
      transit_encryption      = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.uploads.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.container_image_backend
      essential = true
      portMappings = [{ containerPort = 8000, hostPort = 8000, protocol = "tcp" }]
      environment = [for k, v in var.app_env : { name = k, value = tostring(v) }]
      mountPoints = [{ sourceVolume = "uploads", containerPath = "/app/uploads", readOnly = false }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backend.name
          awslogs-region        = data.aws_region.current.id
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
  tags = var.tags
}

# RAG task/service (optional)
resource "aws_ecs_task_definition" "rag" {
  count                    = var.enable_rag_service ? 1 : 0
  family                   = "${local.name_prefix}-rag"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = module.security_output_dummy.execution_role_arn
  task_role_arn            = module.security_output_dummy.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "rag"
      image     = var.container_image_rag
      essential = true
      portMappings = [{ containerPort = 8002, hostPort = 8002, protocol = "tcp" }]
      environment = [
        { name = "AUTH_TOKEN", value = var.rag_auth_token },
        { name = "AUTH_REQUIRED", value = "true" },
        { name = "CHROMA_PERSIST_DIR", value = "/app/chroma" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.rag[0].name
          awslogs-region        = data.aws_region.current.id
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
  tags = var.tags
}

resource "aws_ecs_service" "rag" {
  count           = var.enable_rag_service ? 1 : 0
  name            = "${local.name_prefix}-rag"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.rag[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.services_sg_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.rag[0].arn
  }

  propagate_tags = "SERVICE"
  tags           = var.tags
}

resource "aws_service_discovery_service" "rag" {
  count = var.enable_rag_service ? 1 : 0
  name  = "rag"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config {}
  tags = var.tags
}

# Transformers task/service (optional)
resource "aws_ecs_task_definition" "transformers" {
  count        = var.enable_transformers_service ? 1 : 0
  family       = "${local.name_prefix}-transformers"
  network_mode = "awsvpc"
  requires_compatibilities = var.transformers_use_gpu ? ["EC2"] : ["FARGATE"]
  cpu          = var.transformers_use_gpu ? null : "1024"
  memory       = var.transformers_use_gpu ? null : "2048"
  execution_role_arn = module.security_output_dummy.execution_role_arn
  task_role_arn      = module.security_output_dummy.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "transformers"
      image     = var.container_image_transformers
      essential = true
      portMappings = [{ containerPort = 8001, hostPort = 8001, protocol = "tcp" }]
      resourceRequirements = var.transformers_use_gpu ? [
        { type = "GPU", value = "1" }
      ] : null
      environment = [
        { name = "AUTH_TOKEN", value = var.transformers_auth_token },
        { name = "AUTH_REQUIRED", value = "true" },
        { name = "TRANSFORMERS_CACHE", value = "/app/models_cache" },
        { name = "HF_HOME", value = "/app/models_cache" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.transformers[0].name
          awslogs-region        = data.aws_region.current.id
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
  tags = var.tags
}

resource "aws_ecs_service" "transformers" {
  count           = var.enable_transformers_service ? 1 : 0
  name            = "${local.name_prefix}-transformers"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.transformers[0].arn
  desired_count   = 1
  launch_type     = var.transformers_use_gpu ? null : "FARGATE"
  dynamic "capacity_provider_strategy" {
    for_each = var.transformers_use_gpu ? [1] : []
    content {
      capacity_provider = aws_ecs_capacity_provider.gpu[0].name
      weight            = 1
    }
  }

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.services_sg_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.transformers[0].arn
  }

  propagate_tags = "SERVICE"
  tags           = var.tags
}

# Application Auto Scaling for Transformers service (min 1, max 2)
resource "aws_appautoscaling_target" "transformers" {
  count              = var.enable_transformers_service ? 1 : 0
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.transformers[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 1
  max_capacity       = 2
}

resource "aws_appautoscaling_policy" "transformers_cpu" {
  count              = var.enable_transformers_service ? 1 : 0
  name               = "${local.name_prefix}-transformers-cpu-tt"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.transformers[0].resource_id
  scalable_dimension = aws_appautoscaling_target.transformers[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.transformers[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 60
    scale_out_cooldown = 60
  }
}

resource "aws_service_discovery_service" "transformers" {
  count = var.enable_transformers_service ? 1 : 0
  name  = "transformers"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config {}
  tags = var.tags
}

# Dummy module outputs to wire in roles from security module (referenced from root)
data "aws_region" "current" {}

variable "task_role_arn" { type = string }
variable "execution_role_arn" { type = string }

module "security_output_dummy" {
  source            = "./security-dummy"
  task_role_arn     = var.task_role_arn
  execution_role_arn = var.execution_role_arn
}

# Service
resource "aws_ecs_service" "backend" {
  name            = "${local.name_prefix}-backend"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.services_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 8000
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  propagate_tags                     = "SERVICE"
  tags = var.tags
}

# Application Auto Scaling for Backend service (min 1, max 2)
resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 1
  max_capacity       = 2
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${local.name_prefix}-backend-cpu-tt"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 60
    scale_out_cooldown = 60
  }
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "rag_internal_url" {
  value = var.enable_rag_service ? "http://rag.local:8002" : null
}

output "transformers_internal_url" {
  value = var.enable_transformers_service ? "http://transformers.local:8001" : null
}


