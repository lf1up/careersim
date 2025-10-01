locals {
  name_prefix = "${var.project}-${var.environment}"
}

# RDS Subnet Group
resource "aws_db_subnet_group" "this" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = merge(var.tags, { Name = "${local.name_prefix}-db-subnets" })
}

# RDS PostgreSQL
resource "aws_db_instance" "this" {
  identifier                 = "${local.name_prefix}-postgres"
  engine                     = "postgres"
  engine_version             = var.db_engine_version
  instance_class             = var.db_instance_class
  allocated_storage          = var.db_allocated_storage
  storage_encrypted          = true
  db_name                    = var.db_name
  username                   = var.db_username
  password                   = var.db_password
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = [var.rds_sg_id]
  skip_final_snapshot        = true
  deletion_protection        = false
  publicly_accessible        = false
  backup_retention_period    = 7
  performance_insights_enabled = false
  auto_minor_version_upgrade = true
  apply_immediately          = true
  tags = merge(var.tags, { Name = "${local.name_prefix}-postgres" })
}

# ElastiCache Redis Subnet Group
resource "aws_elasticache_subnet_group" "this" {
  name       = "${local.name_prefix}-redis-subnets"
  subnet_ids = var.private_subnet_ids
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "this" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [var.redis_sg_id]
  parameter_group_name = "default.redis7"
  tags = merge(var.tags, { Name = "${local.name_prefix}-redis" })
}

# EFS
resource "aws_efs_file_system" "this" {
  encrypted = true
  tags      = merge(var.tags, { Name = "${local.name_prefix}-efs" })
}

resource "aws_efs_mount_target" "this" {
  for_each        = { for idx, subnet_id in var.private_subnet_ids : tostring(idx) => subnet_id }
  file_system_id  = aws_efs_file_system.this.id
  subnet_id       = each.value
  security_groups = [var.efs_sg_id]
}


