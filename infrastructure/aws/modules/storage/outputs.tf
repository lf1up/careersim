output "db_endpoint" { value = aws_db_instance.this.address }
output "db_host" { value = aws_db_instance.this.address }
output "db_port" { value = aws_db_instance.this.port }
output "db_name" { value = aws_db_instance.this.db_name != null ? aws_db_instance.this.db_name : "postgres" }

output "redis_endpoint" { value = aws_elasticache_cluster.this.cache_nodes[0].address }
output "redis_host" { value = aws_elasticache_cluster.this.cache_nodes[0].address }
output "redis_port" { value = aws_elasticache_cluster.this.cache_nodes[0].port }

output "efs_id" { value = aws_efs_file_system.this.id }


