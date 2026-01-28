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

resource "aws_lambda_function" "orchestrator" {
  filename         = data.archive_file.orchestrator.output_path
  function_name    = "${var.project_name}-orchestrator"
  role             = aws_iam_role.orchestrator.arn
  handler          = "handler.handler"
  source_code_hash = data.archive_file.orchestrator.output_base64sha256
  runtime          = "nodejs24.x"
  timeout          = 300

  environment {
    variables = {
      LIVE_LOG_TABLE   = aws_dynamodb_table.live_log.name
      HISTORY_TABLE    = aws_dynamodb_table.history_archive.name
      FRONTEND_BUCKET  = aws_s3_bucket.frontend.id
    }
  }
}

# Additional IAM for DynamoDB + S3 will be added when orchestrator logic is implemented.
