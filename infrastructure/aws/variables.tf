variable "project" {
  description = "Project name prefix for resource tagging"
  type        = string
  default     = "careersim"
}

variable "environment" {
  description = "Deployment environment (e.g., dev, staging, prod)"
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS region to deploy to"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "List of public subnet CIDRs"
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "List of private subnet CIDRs"
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

# Optional: reuse an existing VPC and subnets instead of creating new ones
variable "vpc_id" {
  description = "If set, reuse this existing VPC ID. When null, a new VPC is created."
  type        = string
  default     = null
  validation {
    condition     = var.vpc_id == null || (var.public_subnet_ids != null && length(var.public_subnet_ids) > 0 && var.private_subnet_ids != null && length(var.private_subnet_ids) > 0)
    error_message = "When providing vpc_id, you must also provide non-empty public_subnet_ids and private_subnet_ids."
  }
}

variable "public_subnet_ids" {
  description = "Public subnet IDs to reuse when vpc_id is provided. Leave null when creating a new VPC."
  type        = list(string)
  default     = null
}

variable "private_subnet_ids" {
  description = "Private subnet IDs to reuse when vpc_id is provided. Leave null when creating a new VPC."
  type        = list(string)
  default     = null
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS in GB"
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "17.4"
}

variable "db_username" {
  description = "Database master username"
  type        = string
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "enable_rag_service" {
  description = "Whether to deploy the RAG microservice"
  type        = bool
  default     = true
}

variable "enable_transformers_service" {
  description = "Whether to deploy the Transformers microservice"
  type        = bool
  default     = true
}

variable "container_image_backend" {
  description = "ECR image URI for backend"
  type        = string
}

variable "container_image_rag" {
  description = "ECR image URI for rag service"
  type        = string
  default     = null
}

variable "container_image_transformers" {
  description = "ECR image URI for transformers service"
  type        = string
  default     = null
}

variable "allowed_origins" {
  description = "Comma-separated CORS allowed origins"
  type        = string
  default     = "https://vercel.app,https://*.vercel.app"
}

variable "stripe_secret_key" {
  description = "Stripe secret key"
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook secret"
  type        = string
  sensitive   = true
}

variable "stripe_publishable_key" {
  description = "Stripe publishable key"
  type        = string
}

variable "openai_base_url" {
  description = "OpenAI base URL"
  type        = string
  default     = "https://openrouter.ai/api/v1"
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}

variable "transformers_auth_token" {
  description = "Auth token for transformers microservice"
  type        = string
  sensitive   = true
}

variable "rag_auth_token" {
  description = "Auth token for rag microservice"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT secret"
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT refresh secret"
  type        = string
  sensitive   = true
}

variable "session_secret" {
  description = "Session secret"
  type        = string
  sensitive   = true
}

variable "smtp" {
  description = "SMTP configuration"
  type = object({
    host     = string
    port     = number
    secure   = bool
    user     = string
    password = string
  })
}

variable "upload_path" {
  description = "Path inside container for uploads"
  type        = string
  default     = "/app/uploads"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}


variable "transformers_use_gpu" {
  description = "Run Transformers on GPU capacity provider"
  type        = bool
  default     = true
}

variable "gpu_instance_type" {
  description = "EC2 instance type for GPU capacity"
  type        = string
  default     = "g4dn.xlarge"
}

variable "gpu_asg_min" {
  description = "ASG min capacity for GPU nodes"
  type        = number
  default     = 0
}

variable "gpu_asg_desired" {
  description = "ASG desired capacity for GPU nodes"
  type        = number
  default     = 1
}

variable "gpu_asg_max" {
  description = "ASG max capacity for GPU nodes"
  type        = number
  default     = 1
}

variable "port" {
  description = "Backend service port"
  type        = number
  default     = 8000
}

variable "openai_model" {
  description = "OpenAI model name"
  type        = string
  default     = "openai/gpt-5"
}

variable "openai_provider" {
  description = "OpenAI provider id"
  type        = string
  default     = "openai"
}

variable "openai_max_tokens" {
  description = "OpenAI max tokens"
  type        = number
  default     = 4000
}

variable "openai_temperature" {
  description = "OpenAI temperature"
  type        = number
  default     = 0.8
}

variable "openai_top_p" {
  description = "OpenAI top_p"
  type        = number
  default     = 1.0
}

variable "openai_frequency_penalty" {
  description = "OpenAI frequency penalty"
  type        = number
  default     = 0.3
}

variable "openai_presence_penalty" {
  description = "OpenAI presence penalty"
  type        = number
  default     = 0.3
}

variable "rate_limit_window_ms" {
  description = "Rate limit window in ms"
  type        = number
  default     = 900000
}

variable "rate_limit_max_requests" {
  description = "Max requests per window"
  type        = number
  default     = 500
}

variable "max_file_size" {
  description = "Max upload file size in bytes"
  type        = number
  default     = 10485760
}

variable "openai_eval_model" {
  description = "Optional eval model override"
  type        = string
  default     = "google/gemini-2.5-flash"
}

variable "openai_eval_provider" {
  description = "Optional eval provider override"
  type        = string
  default     = "google"
}

variable "openai_eval_max_tokens" {
  description = "Optional eval max tokens override"
  type        = number
  default     = null
}

variable "openai_eval_temperature" {
  description = "Optional eval temperature override"
  type        = number
  default     = 0.3
}

variable "openai_eval_top_p" {
  description = "Optional eval top_p override"
  type        = number
  default     = null
}

variable "openai_eval_frequency_penalty" {
  description = "Optional eval frequency penalty override"
  type        = number
  default     = null
}

variable "openai_eval_presence_penalty" {
  description = "Optional eval presence penalty override"
  type        = number
  default     = null
}


