output "alb_sg_id" { value = aws_security_group.alb.id }
output "services_sg_id" { value = aws_security_group.services.id }
output "rds_sg_id" { value = aws_security_group.rds.id }
output "redis_sg_id" { value = aws_security_group.redis.id }
output "efs_sg_id" { value = aws_security_group.efs.id }

output "ecs_task_role_arn" { value = aws_iam_role.ecs_task.arn }
output "ecs_task_execution_role_arn" { value = aws_iam_role.ecs_task_execution.arn }


