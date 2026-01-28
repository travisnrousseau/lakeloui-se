# API Gateway REST — /admin and Snow Phone only; Tailscale 100.64.0.0/10 on /admin (ARCHITECTURE §1)

resource "aws_api_gateway_rest_api" "main" {
  name        = "${var.project_name}-api"
  description = "lakeloui.se — /admin and Snow Phone"
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# Resource policy: whitelist Tailscale CIDR for execute-api:Invoke on /admin
resource "aws_api_gateway_rest_api_policy" "admin_tailscale" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Principal = "*"
        Action   = "execute-api:Invoke"
        Resource = "${aws_api_gateway_rest_api.main.execution_arn}/*"
        Condition = {
          IpAddress = {
            "aws:SourceIp" = [var.tailscale_cidr]
          }
        }
      }
    ]
  })
}

# Placeholder: add /admin and Snow Phone resources + Lambda integrations when handlers exist.
