locals {
  secgrp_lambda_name = "secgrp-lbd-${var.project_name}-notification"
  cw_lg_lambda_name  = "/aws/lambda/${var.function_name}"

  vpc_id             = data.terraform_remote_state.aws_base.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.aws_base.outputs.private_subnet_ids

  smtp_host = data.terraform_remote_state.k8s.outputs.nlb_dns_name
  smtp_port = data.terraform_remote_state.k8s.outputs.smtp_listener_port

  queue_arn = data.terraform_remote_state.messaging.outputs.queue_arns["notification"]

  base_environment = {
    NODE_ENV = "production"

    SMTP_HOST = local.smtp_host
    SMTP_PORT = tostring(local.smtp_port)
    MAIL_FROM = var.mail_from

    NODE_OPTIONS = "--enable-source-maps"

    SERVICE_VERSION = var.service_version
  }

  telemetry_environment = var.enable_telemetry_collection ? {
    DD_API_KEY = var.telemetry_api_key
    DD_SITE    = var.telemetry_site
    DD_ENV     = "production"
    DD_SERVICE = "oficina-mecanica-lambda-notification"
    DD_VERSION = var.service_version

    DD_SERVERLESS_LOGS_ENABLED = "true"
    DD_TRACE_ENABLED           = "false"
  } : {}

  telemetry_layer_arn = "arn:aws:lambda:${data.aws_region.current.region}:${var.telemetry_extension_layer_account_id}:layer:${var.telemetry_extension_layer_name}:${var.telemetry_extension_layer_version}"

  lambda_layers = var.enable_telemetry_collection ? [local.telemetry_layer_arn] : []
}
