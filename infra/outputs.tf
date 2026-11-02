output "function_name" {
  description = "Function name"
  value       = aws_lambda_function.notification.function_name
}

output "function_arn" {
  description = "Function ARN"
  value       = aws_lambda_function.notification.arn
}

output "function_version" {
  description = "Immutable version published by this apply"
  value       = aws_lambda_function.notification.version
}

output "log_group_name" {
  description = "Function log group"
  value       = aws_cloudwatch_log_group.cw_lg_lambda.name
}

output "event_source_mapping_uuid" {
  description = "UUID of the notification queue event source mapping"
  value       = aws_lambda_event_source_mapping.notification_queue.uuid
}

output "queue_arn" {
  description = "ARN of the notification queue the function consumes"
  value       = local.queue_arn
}
