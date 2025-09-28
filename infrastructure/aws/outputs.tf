output "alb_dns_name" { value = module.compute.alb_dns_name }
output "backend_service_url" { value = "http://${module.compute.alb_dns_name}" }
output "db_endpoint" { value = module.storage.db_endpoint }
output "redis_endpoint" { value = module.storage.redis_endpoint }


