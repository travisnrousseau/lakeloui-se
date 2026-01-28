variable "aws_region" {
  description = "AWS region — ca-west-1 (Calgary) per ARCHITECTURE"
  type        = string
  default     = "ca-west-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "lakeloui-se"
}

variable "tailscale_cidr" {
  description = "Tailscale CIDR for /admin API Gateway policy (100.64.0.0/10)"
  type        = string
  default     = "100.64.0.0/10"
}

variable "environment" {
  description = "Environment (e.g. development, production)"
  type        = string
  default     = "development"
}
