variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "oficina-mecanica"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod-simulated"
}

# ---------------------------------------------------------------------------
# Remote state inputs
# ---------------------------------------------------------------------------

variable "aws_base_state_bucket" {
  description = "S3 bucket name that stores the infra-base Terraform state"
  type        = string
}

variable "aws_base_state_key" {
  description = "S3 object key for the infra-base Terraform state (source of vpc_id and private_subnet_ids)"
  type        = string
  default     = "infra/prod-simulated/infra-base/terraform.tfstate"
}

variable "aws_base_state_region" {
  description = "AWS region of the infra-base state bucket"
  type        = string
  default     = "us-east-1"
}

variable "k8s_state_bucket" {
  description = "S3 bucket name that stores the infra-k8s Terraform state"
  type        = string
}

variable "k8s_state_key" {
  description = "S3 object key for the infra-k8s Terraform state (source of nlb_dns_name and smtp_listener_port)"
  type        = string
  default     = "infra/prod-simulated/infra-k8s/terraform.tfstate"
}

variable "k8s_state_region" {
  description = "AWS region of the infra-k8s state bucket"
  type        = string
  default     = "us-east-1"
}

variable "messaging_state_bucket" {
  description = "S3 bucket name that stores the infra-messaging Terraform state"
  type        = string
}

variable "messaging_state_key" {
  description = "S3 object key for the infra-messaging Terraform state (source of the notification queue ARN)"
  type        = string
  default     = "infra/prod-simulated/infra-messaging/terraform.tfstate"
}

variable "messaging_state_region" {
  description = "AWS region of the infra-messaging state bucket"
  type        = string
  default     = "us-east-1"
}

# ---------------------------------------------------------------------------
# Function
# ---------------------------------------------------------------------------

variable "function_name" {
  description = "Function name"
  type        = string
  default     = "lbd-oficina-mecanica-notification"
}

variable "lambda_execution_role_name" {
  description = "Name of the **pre-existing** execution role in the account"
  type        = string
  default     = "LabRole"
}

variable "lambda_runtime" {
  description = "Function runtime"
  type        = string
  default     = "nodejs24.x"
}

variable "lambda_memory_size" {
  description = "Memory in MB. On the platform memory is also the CPU control"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Timeout in seconds"
  type        = number
  default     = 5
}

variable "log_retention_in_days" {
  description = "Log group retention, in days"
  type        = number
  default     = 14
}

variable "mail_from" {
  description = "Sender address of every email"
  type        = string
  default     = "Oficina Mecânica <noreply@oficina.local>"
}

variable "service_version" {
  description = "Deployed commit SHA. Feeds the service.version attribute the structured logger already emits"
  type        = string
  default     = "dev"
}

# ---------------------------------------------------------------------------
# Telemetry collection
# ---------------------------------------------------------------------------

variable "enable_telemetry_collection" {
  description = "Turns the telemetry collection layer on. When off, the function is provisioned and runs without it"
  type        = bool
  default     = false
}

variable "telemetry_api_key" {
  description = "Telemetry destination API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "telemetry_site" {
  description = "Telemetry destination site"
  type        = string
  default     = "us5.datadoghq.com"
}

variable "telemetry_extension_layer_account_id" {
  description = "Account that publishes the platform telemetry collection layer"
  type        = string
  default     = "464622532012"
}

variable "telemetry_extension_layer_name" {
  description = "Name of the platform telemetry collection layer"
  type        = string
  default     = "Datadog-Extension"
}

variable "telemetry_extension_layer_version" {
  description = "Version of the telemetry collection layer"
  type        = number
  default     = 102
}
