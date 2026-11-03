data "aws_region" "current" {}

data "terraform_remote_state" "aws_base" {
  backend = "s3"

  config = {
    bucket = var.aws_base_state_bucket
    key    = var.aws_base_state_key
    region = var.aws_base_state_region
  }
}

data "terraform_remote_state" "k8s" {
  backend = "s3"

  config = {
    bucket = var.k8s_state_bucket
    key    = var.k8s_state_key
    region = var.k8s_state_region
  }
}

data "terraform_remote_state" "messaging" {
  backend = "s3"

  config = {
    bucket = var.messaging_state_bucket
    key    = var.messaging_state_key
    region = var.messaging_state_region
  }
}

data "aws_iam_role" "lambda_execution" {
  name = var.lambda_execution_role_name
}

data "archive_file" "package" {
  type             = "zip"
  source_dir       = "${path.module}/../app/dist"
  output_path      = "${path.module}/build/handler.zip"
  output_file_mode = "0644"
}
