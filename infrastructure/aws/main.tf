data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

module "network" {
  count  = var.vpc_id == null ? 1 : 0
  source = "./modules/network"

  project               = var.project
  environment           = var.environment
  vpc_cidr              = var.vpc_cidr
  public_subnet_cidrs   = var.public_subnet_cidrs
  private_subnet_cidrs  = var.private_subnet_cidrs
  tags                  = local.common_tags
}

locals {
  selected_vpc_id             = var.vpc_id != null ? var.vpc_id : module.network[0].vpc_id
  selected_public_subnet_ids  = var.vpc_id != null ? var.public_subnet_ids : module.network[0].public_subnet_ids
  selected_private_subnet_ids = var.vpc_id != null ? var.private_subnet_ids : module.network[0].private_subnet_ids
}

module "security" {
  source = "./modules/security"

  project     = var.project
  environment = var.environment
  vpc_id      = local.selected_vpc_id
  tags        = local.common_tags
}

module "storage" {
  source = "./modules/storage"

  project           = var.project
  environment       = var.environment
  vpc_id            = local.selected_vpc_id
  private_subnet_ids = local.selected_private_subnet_ids
  db_instance_class = var.db_instance_class
  db_allocated_storage = var.db_allocated_storage
  db_engine_version = var.db_engine_version
  db_name           = var.project
  db_username       = var.db_username
  db_password       = var.db_password
  redis_node_type   = var.redis_node_type
  rds_sg_id         = module.security.rds_sg_id
  redis_sg_id       = module.security.redis_sg_id
  efs_sg_id         = module.security.efs_sg_id
  tags              = local.common_tags
}

module "compute" {
  source = "./modules/compute"

  project             = var.project
  environment         = var.environment
  vpc_id              = local.selected_vpc_id
  public_subnet_ids   = local.selected_public_subnet_ids
  private_subnet_ids  = local.selected_private_subnet_ids

  alb_sg_id           = module.security.alb_sg_id
  services_sg_id      = module.security.services_sg_id
  rds_sg_id           = module.security.rds_sg_id
  redis_sg_id         = module.security.redis_sg_id
  efs_sg_id           = module.security.efs_sg_id

  db_endpoint         = module.storage.db_endpoint
  db_database         = module.storage.db_name
  redis_endpoint      = module.storage.redis_endpoint
  efs_id              = module.storage.efs_id
  efs_mount_targets_sg = module.security.efs_sg_id

  container_image_backend      = var.container_image_backend
  container_image_rag          = var.container_image_rag
  container_image_transformers = var.container_image_transformers

  enable_rag_service           = var.enable_rag_service
  enable_transformers_service  = var.enable_transformers_service
  rag_auth_token               = var.rag_auth_token
  transformers_auth_token      = var.transformers_auth_token
  transformers_use_gpu         = var.transformers_use_gpu
  gpu_instance_type            = var.gpu_instance_type
  gpu_asg_min                  = var.gpu_asg_min
  gpu_asg_desired              = var.gpu_asg_desired
  gpu_asg_max                  = var.gpu_asg_max

  # Sensitive and runtime env
  app_env = {
    NODE_ENV                     = var.environment
    PORT                         = var.port
    DB_HOST                      = module.storage.db_host
    DB_PORT                      = module.storage.db_port
    DB_USERNAME                  = var.db_username
    DB_PASSWORD                  = var.db_password
    DB_DATABASE                  = module.storage.db_name
    DB_SYNCHRONIZE               = "false"
    DB_LOGGING                   = "false"
    JWT_SECRET                   = var.jwt_secret
    JWT_EXPIRES_IN               = "7d"
    JWT_REFRESH_SECRET           = var.jwt_refresh_secret
    JWT_REFRESH_EXPIRES_IN       = "30d"
    SESSION_SECRET               = var.session_secret
    REDIS_HOST                   = module.storage.redis_host
    REDIS_PORT                   = module.storage.redis_port
    REDIS_PASSWORD               = ""
    SMTP_HOST                    = var.smtp.host
    SMTP_PORT                    = var.smtp.port
    SMTP_SECURE                  = var.smtp.secure ? "true" : "false"
    SMTP_USER                    = var.smtp.user
    SMTP_PASS                    = var.smtp.password
    OPENAI_BASE_URL              = var.openai_base_url
    OPENAI_API_KEY               = var.openai_api_key
    OPENAI_MODEL                 = var.openai_model
    OPENAI_PROVIDER              = var.openai_provider
    OPENAI_MAX_TOKENS            = var.openai_max_tokens
    OPENAI_TEMPERATURE           = var.openai_temperature
    OPENAI_TOP_P                 = var.openai_top_p
    OPENAI_FREQUENCY_PENALTY     = var.openai_frequency_penalty
    OPENAI_PRESENCE_PENALTY      = var.openai_presence_penalty
    OPENAI_EVAL_MODEL            = var.openai_eval_model == null ? var.openai_model : var.openai_eval_model
    OPENAI_EVAL_PROVIDER         = var.openai_eval_provider == null ? var.openai_provider : var.openai_eval_provider
    OPENAI_EVAL_MAX_TOKENS       = var.openai_eval_max_tokens == null ? var.openai_max_tokens : var.openai_eval_max_tokens
    OPENAI_EVAL_TEMPERATURE      = var.openai_eval_temperature == null ? var.openai_temperature : var.openai_eval_temperature
    OPENAI_EVAL_TOP_P            = var.openai_eval_top_p == null ? var.openai_top_p : var.openai_eval_top_p
    OPENAI_EVAL_FREQUENCY_PENALTY = var.openai_eval_frequency_penalty == null ? var.openai_frequency_penalty : var.openai_eval_frequency_penalty
    OPENAI_EVAL_PRESENCE_PENALTY = var.openai_eval_presence_penalty == null ? var.openai_presence_penalty : var.openai_eval_presence_penalty
    TRANSFORMERS_API_URL         = "http://transformers.local:8001"
    TRANSFORMERS_API_KEY         = var.transformers_auth_token
    RAG_API_URL                  = "http://rag.local:8002"
    RAG_API_KEY                  = var.rag_auth_token
    STRIPE_SECRET_KEY            = var.stripe_secret_key
    STRIPE_WEBHOOK_SECRET        = var.stripe_webhook_secret
    STRIPE_PUBLISHABLE_KEY       = var.stripe_publishable_key
    MAX_FILE_SIZE                = var.max_file_size
    UPLOAD_PATH                  = var.upload_path
    RATE_LIMIT_WINDOW_MS         = var.rate_limit_window_ms
    RATE_LIMIT_MAX_REQUESTS      = var.rate_limit_max_requests
    ALLOWED_ORIGINS              = var.allowed_origins
  }

  tags = local.common_tags
  task_role_arn        = module.security.ecs_task_role_arn
  execution_role_arn   = module.security.ecs_task_execution_role_arn
}

# Secrets (optional centralization)
module "secrets" {
  source      = "./modules/secrets"
  project     = var.project
  environment = var.environment
  tags        = local.common_tags
  secrets = {
    OPENAI_API_KEY        = var.openai_api_key
    JWT_SECRET            = var.jwt_secret
    JWT_REFRESH_SECRET    = var.jwt_refresh_secret
    SESSION_SECRET        = var.session_secret
    STRIPE_SECRET_KEY     = var.stripe_secret_key
    STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
    STRIPE_PUBLISHABLE_KEY = var.stripe_publishable_key
    SMTP_HOST             = var.smtp.host
    SMTP_PORT             = var.smtp.port
    SMTP_SECURE           = var.smtp.secure ? "true" : "false"
    SMTP_USER             = var.smtp.user
    SMTP_PASS             = var.smtp.password
    RAG_API_KEY           = var.rag_auth_token
    TRANSFORMERS_API_KEY  = var.transformers_auth_token
  }
}

 
