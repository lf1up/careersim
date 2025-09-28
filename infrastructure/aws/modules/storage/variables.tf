variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }

variable "db_instance_class" { type = string }
variable "db_allocated_storage" { type = number }
variable "db_engine_version" { type = string }
variable "db_name" { type = string }
variable "db_username" { type = string }
variable "db_password" { type = string }

variable "redis_node_type" { type = string }

variable "rds_sg_id" { type = string }
variable "redis_sg_id" { type = string }
variable "efs_sg_id" { type = string }

variable "tags" { type = map(string) }


