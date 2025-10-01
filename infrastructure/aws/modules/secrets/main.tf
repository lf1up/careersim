locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_secretsmanager_secret" "env" {
  name        = "${local.name_prefix}-app-secrets"
  description = "App secrets for ${local.name_prefix}"
  tags        = var.tags
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "env" {
  secret_id     = aws_secretsmanager_secret.env.id
  secret_string = jsonencode(var.secrets)
}

output "secret_arn" { value = aws_secretsmanager_secret.env.arn }


