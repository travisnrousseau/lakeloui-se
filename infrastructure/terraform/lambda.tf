# Mono-Lambda orchestrator — EventBridge every 15 min; see ARCHITECTURE §2
# Run `cd backend && npm ci && npm run build` before first apply.

data "archive_file" "orchestrator" {
  type        = "zip"
  source_dir  = "${path.module}/../../backend/dist"
  output_path = "${path.module}/build/orchestrator.zip"
}

resource "aws_iam_role" "orchestrator" {
  name = "${var.project_name}-orchestrator-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "orchestrator_basic" {
  role       = aws_iam_role.orchestrator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "orchestrator_extra" {
  name = "${var.project_name}-orchestrator-extra"
  role = aws_iam_role.orchestrator.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ]
        Effect   = "Allow"
        Resource = [
          aws_dynamodb_table.live_log.arn,
          aws_dynamodb_table.history_archive.arn
        ]
      },
      {
        Action = [
          "s3:PutObject"
        ]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
      },
      {
        Action = [
          "s3:PutObject"
        ]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.archive.arn}/*"
      },
      {
        Action   = "cloudfront:CreateInvalidation"
        Effect   = "Allow"
        Resource = aws_cloudfront_distribution.frontend.arn
      }
    ]
  })
}

resource "aws_lambda_function" "orchestrator" {
  filename         = data.archive_file.orchestrator.output_path
  function_name    = "${var.project_name}-orchestrator"
  role             = aws_iam_role.orchestrator.arn
  handler          = "handler.handler"
  source_code_hash = data.archive_file.orchestrator.output_base64sha256
  runtime          = "nodejs22.x"
  memory_size      = 2048 # was 1024; heavy model processing and JPEG2000
  timeout          = 600  # 10 min; multiple models + vertical profiles + FireWork

  environment {
    variables = {
      NODE_ENV                     = "development" # use patched vgrib2 development build (template 5.40 / JPEG2000)
      LIVE_LOG_TABLE               = aws_dynamodb_table.live_log.name
      HISTORY_TABLE                = aws_dynamodb_table.history_archive.name
      FRONTEND_BUCKET               = aws_s3_bucket.frontend.id
      ARCHIVE_BUCKET                 = aws_s3_bucket.archive.id
      FRONTEND_DISTRIBUTION_ID      = aws_cloudfront_distribution.frontend.id
      GEOMET_ENABLED               = "1"           # fetch Canadian models (HRDPS/RDPS/GDPS) every run; save forecast to DynamoDB
      WEATHERLINK_API_KEY          = var.weatherlink_api_key
      WEATHERLINK_API_SECRET       = var.weatherlink_api_secret
      WEATHERLINK_STATION_ID       = var.weatherlink_station_id
      WEATHERLINK_STATION_ID_BASE  = var.weatherlink_station_id_base
    }
  }
}
