output "frontend_bucket" {
  description = "S3 bucket for static frontend"
  value       = aws_s3_bucket.frontend.id
}

output "archive_bucket" {
  description = "S3 bucket for snapshot archive (180d → Glacier); for year-over-year comparison"
  value       = aws_s3_bucket.archive.id
}

output "cloudfront_url" {
  description = "CloudFront distribution URL"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_domain" {
  description = "CloudFront domain name"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_url" {
  description = "Frontend URL (custom domain if route53_zone_id set, else CloudFront default)"
  value       = var.route53_zone_id != "" ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "live_log_table" {
  description = "DynamoDB Live_Log table name"
  value       = aws_dynamodb_table.live_log.name
}

output "history_archive_table" {
  description = "DynamoDB History_Archive table name"
  value       = aws_dynamodb_table.history_archive.name
}

output "orchestrator_lambda_arn" {
  description = "Mono-Lambda orchestrator ARN"
  value       = aws_lambda_function.orchestrator.arn
}
