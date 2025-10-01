## AWS Infrastructure (Terraform) — Deployment Guide

This directory contains Terraform code to provision the production-ready AWS infrastructure for Careersim.

### What gets created
- **Network**: VPC, 2 public subnets, 2 private subnets, Internet Gateway, NAT Gateway, routing
- **Security**: Security groups for ALB, services (ECS tasks), RDS, Redis, EFS; IAM roles for ECS tasks and execution
- **Storage**: RDS PostgreSQL, ElastiCache Redis, EFS with a dedicated Access Point for uploads
- **Compute**: ECS cluster, Application Load Balancer (ALB), backend service on Fargate, optional RAG and Transformers services (Fargate or GPU-backed EC2 capacity provider), AWS Cloud Map private DNS (`local`) for internal service discovery
- **Observability**: CloudWatch Log Groups for each service

Outputs include the ALB DNS name and a convenience `backend_service_url`.

> Cost note: NAT Gateway, RDS, EFS, ALB, and optionally GPU instances have non-trivial ongoing costs. Use a low-cost region and disable GPU if you don’t need it.

---

## Prerequisites
- Terraform >= 1.6
- AWS CLI v2, configured with credentials and default region having sufficient permissions
- Docker (to build application images)

Recommended environment variables for commands below:
```bash
export AWS_REGION="us-east-1"
export AWS_PROFILE="default"   # if you use profiles
export TF_VAR_aws_region="$AWS_REGION"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

---

## Build and push container images (ECR)
You must push images to ECR, then reference the image URIs in Terraform.

1) Create ECR repositories (idempotent):
```bash
aws ecr create-repository --repository-name careersim-backend || true
aws ecr create-repository --repository-name careersim-rag || true
aws ecr create-repository --repository-name careersim-transformers || true
```

2) Authenticate Docker to ECR:
```bash
aws ecr get-login-password --region "$AWS_REGION" | docker login \
  --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

3) Build and push Backend image:
```bash
cd ../../backend
docker build -t careersim-backend:latest --build-arg NODE_ENV=production .
docker tag careersim-backend:latest "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/careersim-backend:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/careersim-backend:latest"
cd -
```

4) (Optional) Build and push RAG image:
```bash
cd ../../rag
docker build -t careersim-rag:latest .
docker tag careersim-rag:latest "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/careersim-rag:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/careersim-rag:latest"
cd -
```

5) (Optional) Build and push Transformers image:
```bash
cd ../../transformers
docker build -t careersim-transformers:latest .
docker tag careersim-transformers:latest "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/careersim-transformers:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/careersim-transformers:latest"
cd -
```

Record the three image URIs for use in `terraform.tfvars`.

---

## Configuration
All configurable inputs live in `variables.tf`. Key settings include:
- `project`, `environment`, `aws_region`, `vpc_cidr`, `public_subnet_cidrs`, `private_subnet_cidrs`
- Container images and toggles: `container_image_backend`, `container_image_rag`, `container_image_transformers`, `enable_rag_service`, `enable_transformers_service`
- GPU/EC2 capacity for Transformers: set `transformers_use_gpu` to `false` if you want pure Fargate (no GPU ASG)
- Secrets: `db_username`, `db_password`, `jwt_secret`, `jwt_refresh_secret`, `session_secret`, `openai_api_key`, `stripe_*`, `smtp` object, `rag_auth_token`, `transformers_auth_token`
- CORS: `allowed_origins` (defaults to Vercel domains)

> Secrets are passed to the backend task as environment variables. This repo also includes a `secrets` module which stores them in AWS Secrets Manager for centralization, though the app tasks read from environment variables provided by Terraform.

### Example terraform.tfvars
Create `infrastructure/aws/terraform.tfvars` (do not commit sensitive values):
```hcl
project       = "careersim"
environment   = "production"
aws_region    = "us-east-1"

# Application images (from ECR above)
container_image_backend      = "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/careersim-backend:latest"
enable_rag_service           = true
container_image_rag          = "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/careersim-rag:latest"
enable_transformers_service  = true
container_image_transformers = "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/careersim-transformers:latest"

# Consider disabling GPU in non-prod to reduce cost
transformers_use_gpu = false

# Database
db_username = "careersim"
db_password = "REPLACE_ME"

# SMTP configuration
smtp = {
  host     = "smtp.example.com"
  port     = 587
  secure   = false
  user     = "smtp-user"
  password = "smtp-pass"
}

# Auth and third-party keys
jwt_secret           = "REPLACE_ME"
jwt_refresh_secret   = "REPLACE_ME"
session_secret       = "REPLACE_ME"
openai_api_key       = "REPLACE_ME"
rag_auth_token       = "REPLACE_ME"
transformers_auth_token = "REPLACE_ME"

# Stripe
stripe_secret_key       = "REPLACE_ME"
stripe_webhook_secret   = "REPLACE_ME"
stripe_publishable_key  = "REPLACE_ME"

# CORS
allowed_origins = "https://yourapp.vercel.app,https://*.vercel.app"

# Reuse existing networking
# vpc_id            = "vpc-xxxxxxxx"
# public_subnet_ids = ["subnet-aaaaaaa", "subnet-bbbbbbb"]
# private_subnet_ids = ["subnet-ccccccc", "subnet-ddddddd"]

# Optional tuning
# db_instance_class       = "db.t4g.medium"
# db_allocated_storage    = 20
# openai_model            = "openai/gpt-5"
# openai_eval_model       = "google/gemini-2.5-pro"
```

> Tip: Add `terraform.tfvars` to your global/local gitignore to avoid committing secrets.

---

## Deploy
From this directory (`infrastructure/aws`):
```bash
terraform init
terraform plan -out tf.plan
terraform apply tf.plan
```

Key outputs:
```bash
terraform output
terraform output -raw backend_service_url
terraform output -raw alb_dns_name
```

Once applied, the backend should be reachable at the `backend_service_url` (ALB HTTP on port 80). Health checks hit `/health` on the backend.

---

## Post-deploy checks
- Confirm `aws ecs list-services` shows services as ACTIVE and healthy
- In AWS Console → EC2 → Target Groups, verify targets are healthy
- Check logs in CloudWatch Log Groups `/ecs/<project>-<env>-*`
- Test API: `curl $(terraform output -raw backend_service_url)/health`
- Ensure `allowed_origins` includes your frontend domain(s)

---

## Operations
- Scaling: Backend and Transformers services have target-tracking scaling (CPU 60%, min 1, max 2)
- Service discovery: Backend resolves `transformers.local:8001` and `rag.local:8002` via Cloud Map if those services are enabled
- File uploads: Backend mounts EFS via an Access Point at `/app/uploads`

---

## Cleanup
Destroy the environment:
```bash
terraform destroy
```

> RDS is configured with `skip_final_snapshot = true` for convenience. For production, consider enabling final snapshots to preserve data.

---

## Troubleshooting
- ALB 502/503: Check target group health, security groups, container logs
- CORS errors: Update `allowed_origins`
- Transformers cost: Set `transformers_use_gpu = false` to use Fargate instead of GPU EC2
- RAG persistence: Current task definition uses container storage; add EFS if you need persistence across redeploys


