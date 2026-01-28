# lakeloui.se — Infrastructure (Terraform)

AWS ca-west-1, serverless only. See [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Before first apply

1. Ensure backend is built: `cd backend && npm ci && npm run build`
2. From this repo root: `nix develop` (or install Terraform + AWS CLI yourself)
3. `cd infrastructure/terraform && terraform init && terraform plan`

## Layout

- `terraform/` — S3, CloudFront, DynamoDB (Live_Log, History_Archive), Lambda, EventBridge, API Gateway
