resource "aws_cloudwatch_log_group" "cw_lg_lambda" {
  name              = local.cw_lg_lambda_name
  retention_in_days = var.log_retention_in_days

  tags = {
    Name = local.cw_lg_lambda_name
  }
}
