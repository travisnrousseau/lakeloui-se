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

# 4am report email — full index.html (including AI summary) sent when 4am MST report runs (SES).
variable "report_4am_email" {
  description = "Email address to receive the 4am Snow Reporters report (full index HTML). Leave empty to disable."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ses_from_email" {
  description = "SES verified sender address (From) for 4am report emails (e.g. WorkMail-hosted info@rousseau.tv)."
  type        = string
  default     = ""
  sensitive   = true
}

# OpenRouter — AI narrative (6am public / 4am Snow Reporters). Set in terraform.tfvars or TF_VAR_openrouter_api_key.
variable "openrouter_api_key" {
  description = "OpenRouter API key for AI forecast narrative (6am/4am reports). Leave empty to skip AI; report still renders with groomer fallback."
  type        = string
  default     = ""
  sensitive   = true
}
