resource "aws_lambda_function" "notification" {
  function_name = var.function_name
  description   = "Envio de e-mails da fila de notificação"

  role = data.aws_iam_role.lambda_execution.arn

  filename         = data.archive_file.package.output_path
  source_code_hash = data.archive_file.package.output_base64sha256

  runtime = var.lambda_runtime
  handler = "handler.handler"

  memory_size = var.lambda_memory_size
  timeout     = var.lambda_timeout

  vpc_config {
    subnet_ids         = local.private_subnet_ids
    security_group_ids = [aws_security_group.secgrp_lambda.id]
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.cw_lg_lambda.name
  }

  layers = local.lambda_layers

  environment {
    variables = merge(local.base_environment, local.telemetry_environment)
  }

  publish = true

  tags = {
    Name           = var.function_name
    ServiceVersion = var.service_version
  }

  depends_on = [aws_cloudwatch_log_group.cw_lg_lambda]
}

resource "aws_lambda_event_source_mapping" "notification_queue" {
  event_source_arn = local.queue_arn
  function_name    = aws_lambda_function.notification.arn
  batch_size       = 1

  # Caps the queue's draw on the account concurrency without reserving any for the function
  scaling_config {
    maximum_concurrency = 10
  }

  function_response_types = ["ReportBatchItemFailures"]
}
