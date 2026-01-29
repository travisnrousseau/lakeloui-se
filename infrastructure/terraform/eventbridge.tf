# EventBridge every 15 minutes — lower cost; ARCHITECTURE §2 trigger

# One-time cleanup: remove legacy 5-min rule (if present). Run on first apply after migration to 15 min.
resource "null_resource" "remove_legacy_5min_rule" {
  triggers = {
    project = var.project_name
  }
  provisioner "local-exec" {
    command     = "aws events remove-targets --rule ${var.project_name}-orchestrator-5min --ids OrchestratorLambda 2>/dev/null; aws events delete-rule --name ${var.project_name}-orchestrator-5min 2>/dev/null; true"
    interpreter = ["sh", "-c"]
  }
}

resource "aws_cloudwatch_event_rule" "orchestrator" {
  name                = "${var.project_name}-orchestrator-15min"
  description         = "Trigger Mono-Lambda every 15 minutes"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "orchestrator" {
  rule      = aws_cloudwatch_event_rule.orchestrator.name
  target_id = "OrchestratorLambda"
  arn       = aws_lambda_function.orchestrator.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.orchestrator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.orchestrator.arn
}
