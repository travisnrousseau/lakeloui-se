# lakeloui.se — Infrastructure (Terraform)

AWS ca-west-1, serverless only. See [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Before first apply

1. Ensure backend is built: `cd backend && npm ci && npm run build`
2. From this repo root: `nix develop` (or install Terraform + AWS CLI yourself)
3. **WeatherLink:** Terraform needs `weatherlink_api_key` and `weatherlink_api_secret` in `terraform.tfvars`. To copy them from `backend/.env`: run `infrastructure/terraform/populate-tfvars-from-env.sh` from the repo root (or `./populate-tfvars-from-env.sh` from `infrastructure/terraform`).
4. `cd infrastructure/terraform && terraform init && terraform plan`

## Custom domain wx.lakeloui.se (Route 53)

If the domain **lakeloui.se** is in Route 53:

1. Get the hosted zone ID: AWS Console → Route 53 → Hosted zones → **lakeloui.se** → copy the ID (e.g. `Z0123456789ABCDEF`), or run:  
   `aws route53 list-hosted-zones --query "HostedZones[?Name=='lakeloui.se.'].Id" --output text`
2. In `terraform.tfvars` set:
   - `domain_name     = "wx.lakeloui.se"`
   - `route53_zone_id = "Z0123456789ABCDEF"` (your zone ID)
3. `terraform plan` then `terraform apply`. Terraform will:
   - Request an ACM certificate for **wx.lakeloui.se** (in us-east-1, required for CloudFront)
   - Create DNS validation CNAME records in your hosted zone
   - Wait for validation (or run apply again after a few minutes if the first apply fails on CloudFront cert)
   - Add an **A** record **wx.lakeloui.se** → CloudFront
   - Attach the cert to CloudFront and add **wx.lakeloui.se** as an alias
4. The site will be available at **https://wx.lakeloui.se** (CloudFront default URL still works).

Leave `route53_zone_id` empty to keep using only the default CloudFront URL.

## Layout

- `terraform/` — S3, CloudFront, DynamoDB (Live_Log, History_Archive), Lambda, EventBridge, API Gateway, ACM + Route 53 for wx.lakeloui.se
