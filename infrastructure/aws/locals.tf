locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = merge({
    Project     = var.project,
    Environment = var.environment,
    ManagedBy   = "terraform",
  }, var.tags)
}


