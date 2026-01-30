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

# WeatherLink API v2 — Paradise Top + Base (Operations). Set in terraform.tfvars or TF_VAR_* (do not commit secrets).
variable "weatherlink_api_key" {
  description = "WeatherLink API Key v2"
  type        = string
  default     = ""
  sensitive   = true
}

variable "weatherlink_api_secret" {
  description = "WeatherLink API Secret v2"
  type        = string
  default     = ""
  sensitive   = true
}

variable "weatherlink_station_id" {
  description = "WeatherLink station ID for Paradise Top (from dashboard)"
  type        = string
  default     = "23431"
}

variable "weatherlink_station_id_base" {
  description = "WeatherLink station ID for Base (Operations); optional"
  type        = string
  default     = "23428"
}

# Custom domain wx.lakeloui.se — Route 53 + ACM (see infrastructure/terraform/README.md)
variable "domain_name" {
  description = "Custom domain for the frontend (e.g. wx.lakeloui.se)"
  type        = string
  default     = "wx.lakeloui.se"
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for the parent domain (e.g. lakeloui.se). Required for DNS and ACM validation."
  type        = string
  default     = ""
}
