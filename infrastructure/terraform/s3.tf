# Static frontend bucket — ARCHITECTURE §1: S3 + CloudFront

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-frontend-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-frontend"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Snapshot archive — long-term storage for year-over-year comparison (ARCHITECTURE §6)
# Lambda writes each 15-min snapshot here; after 180 days objects move to Glacier Flexible Retrieval.
# Objects remain retrievable (Standard 3–5 hr or Bulk for many at once) for comparison.

resource "aws_s3_bucket" "archive" {
  bucket = "${var.project_name}-archive-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-archive"
  }
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket = aws_s3_bucket.archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id

  rule {
    id     = "glacier-after-180-days"
    status = "Enabled"

    filter {} # apply to whole bucket (required by provider)

    transition {
      days          = 180
      storage_class = "GLACIER"
    }
  }
}

data "aws_caller_identity" "current" {}
