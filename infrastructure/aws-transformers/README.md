# Standalone Transformers Service (AWS ECS + ALB)

Deploy the Transformers microservice independently. This stack provisions (or reuses) a VPC, ECS Fargate cluster/task/service, and a public ALB that exposes port 80 → container port 8001.

## Inputs

- `container_image_transformers` (required): ECR image URI, e.g. `123456789012.dkr.ecr.us-east-1.amazonaws.com/transformers:latest`
- `transformers_auth_token` (required): Bearer token for the service
- `aws_region`: Default `us-east-1`
- Network reuse (optional): `vpc_id`, `public_subnet_ids`, `private_subnet_ids`
- Or create new VPC via: `vpc_cidr`, `public_subnet_cidrs`, `private_subnet_cidrs`

## Usage

```hcl
terraform {
  required_version = ">= 1.5.0"
}

provider "aws" {
  region = "us-east-1"
}

module "transformers" {
  source = "./infrastructure/aws-transformers"

  project                      = "careersim"
  environment                  = "dev-transformers"
  container_image_transformers = var.container_image_transformers
  transformers_auth_token      = var.transformers_auth_token

  # Option A: Create a new VPC (default)
  # vpc_cidr             = "10.50.0.0/16"
  # public_subnet_cidrs  = ["10.50.0.0/24", "10.50.1.0/24"]
  # private_subnet_cidrs = ["10.50.10.0/24", "10.50.11.0/24"]

  # Option B: Reuse existing VPC
  # vpc_id             = "vpc-abc123"
  # public_subnet_ids  = ["subnet-1", "subnet-2"]
  # private_subnet_ids = ["subnet-3", "subnet-4"]
}
```

Then:

```bash
terraform init
terraform apply -auto-approve \
  -var container_image_transformers=$ECR_IMAGE \
  -var transformers_auth_token=$AUTH_TOKEN
```

## Outputs

- `alb_dns_name`: Public URL of the service, e.g. `http://<alb-dns-name>`

## Notes

- Container port is 8001; health check path is `/health`.
 - Fargate-only for simplicity; GPU support is not included in this module.

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
