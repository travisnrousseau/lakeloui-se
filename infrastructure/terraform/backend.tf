# Backend config — use S3 + DynamoDB for team/CI (see README)
# Uncomment and set bucket/key when moving off local state.

# backend "s3" {
#   bucket         = "lakeloui-se-terraform-state"
#   key            = "terraform.tfstate"
#   region         = "ca-west-1"
#   dynamodb_table = "lakeloui-se-terraform-lock"
# }
