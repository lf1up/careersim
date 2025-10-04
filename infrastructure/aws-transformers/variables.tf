variable "project" {
  type    = string
  default = "careersim"
}
variable "environment" {
  type    = string
  default = "transformers"
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# Network reuse or create toggles
variable "vpc_id" {
  type    = string
  default = null
}
variable "public_subnet_ids" {
  type    = list(string)
  default = null
}
variable "private_subnet_ids" {
  type    = list(string)
  default = null
}

# When creating a new VPC
variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16"
}
variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.50.0.0/24", "10.50.1.0/24"]
}
variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.50.10.0/24", "10.50.11.0/24"]
}

# Service image and auth
variable "container_image_transformers" {
  type = string
}
variable "transformers_auth_token" {
  type      = string
  sensitive = true
}

## Fargate-only stack; GPU options removed for simplicity

variable "tags" {
  type    = map(string)
  default = {}
}

variable "key_name" {
  type    = string
  default = null
}

variable "ssh_ingress_cidr" {
  type    = string
  default = null
}

variable "root_volume_size" {
  type    = number
  default = 200
}


