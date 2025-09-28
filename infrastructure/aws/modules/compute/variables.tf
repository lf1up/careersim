variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }

variable "alb_sg_id" { type = string }
variable "services_sg_id" { type = string }
variable "rds_sg_id" { type = string }
variable "redis_sg_id" { type = string }
variable "efs_sg_id" { type = string }

variable "db_endpoint" { type = string }
variable "db_database" { type = string }
variable "redis_endpoint" { type = string }
variable "efs_id" { type = string }
variable "efs_mount_targets_sg" { type = string }

variable "container_image_backend" { type = string }
variable "container_image_rag" { type = string }
variable "container_image_transformers" { type = string }
variable "enable_rag_service" { type = bool }
variable "enable_transformers_service" { type = bool }
variable "rag_auth_token" { type = string }
variable "transformers_auth_token" { type = string }

# GPU/EC2 capacity for Transformers
variable "transformers_use_gpu" {
  type        = bool
  description = "Run Transformers service on EC2 GPU capacity provider"
  default     = false
}

variable "gpu_instance_type" {
  type        = string
  description = "EC2 instance type for GPU capacity"
  default     = "g4dn.xlarge"
}

variable "gpu_asg_min" {
  type        = number
  description = "ASG min capacity for GPU nodes"
  default     = 0
}

variable "gpu_asg_desired" {
  type        = number
  description = "ASG desired capacity for GPU nodes"
  default     = 1
}

variable "gpu_asg_max" {
  type        = number
  description = "ASG max capacity for GPU nodes"
  default     = 2
}

variable "app_env" {
  type        = map(string)
  description = "Flat map of environment variables to inject into backend container"
}

variable "tags" { type = map(string) }


