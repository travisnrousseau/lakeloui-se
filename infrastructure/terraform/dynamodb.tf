# DynamoDB On-Demand — ARCHITECTURE §1: Live_Log (5-min snapshots), History_Archive (50-year)

resource "aws_dynamodb_table" "live_log" {
  name         = "${var.project_name}-Live_Log"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  tags = {
    Name = "${var.project_name}-Live_Log"
  }
}

resource "aws_dynamodb_table" "history_archive" {
  name         = "${var.project_name}-History_Archive"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  tags = {
    Name = "${var.project_name}-History_Archive"
  }
}
