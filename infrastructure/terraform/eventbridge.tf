# EventBridge every 15 minutes — ARCHITECTURE §2 trigger

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
