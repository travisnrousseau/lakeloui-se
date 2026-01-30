# lakeloui.se — Trav's Weather Dashboard

Honest, independent "Where & Why" weather and snow report for Lake Louise. Mountain-guide tone, scale-to-zero AWS (ca-west-1).

## Specs

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Infrastructure, Mono-Lambda orchestrator, coordinate pins.
- **[docs/CONTENT_LOGIC.md](docs/CONTENT_LOGIC.md)** — Stash Finder, Groomer Check, operational gates, forecast model consensus.
- **[docs/MODELS_ROCKIES_OPERATIONS.md](docs/MODELS_ROCKIES_OPERATIONS.md)** — Why HRDPS/RDPS/GDPS for Canadian Rockies ski ops (resolution, orographic lift, wind channelling, Chinook, freezing level).

## Stack (target)

- **Frontend:** S3 + CloudFront, Alpine.js + Vite, semantic HTML, Midnight Alpine UI.
- **Backend:** Node.js 22 + TypeScript Mono-Lambda (EventBridge every 15 min).
- **Data:** WeatherLink, GOES, Resort XML; DynamoDB `Live_Log` + `History_Archive`.
- **Infra:** Terraform. Historical backfill: Python 3.12 (EC/ACIS).

## Repo layout

```
backend/         # Mono-Lambda orchestrator (Node 22 / TS)
frontend/       # Alpine.js + Vite static site
infrastructure/ # Terraform (AWS ca-west-1)
scripts/        # Historical backfill (Python 3.12), one-off tooling
docs/           # ARCHITECTURE, CONTENT_LOGIC
flake.nix       # Dev env: Terraform, Node 22, AWS CLI, Python 3.12
```

## Development

Enter the Nix dev shell (Terraform, Node.js 22, AWS CLI, Python 3.12):

```bash
nix develop
```

Before first Terraform apply: `cd backend && npm ci && npm run build`.

### View dashboard locally

From `backend/`:

- **Build, render, and open in browser:** `npm run dry-render:open`
- **Render only (no open):** `npm run dry-render` — then open `file:///tmp/lakeloui_live_dry_index.html` in your browser.

The first run fetches models (GeoMet HRDPS/RDPS/GDPS); later runs use cache until stale (e.g. 5 h for models). To force a fresh fetch: `FORCE_FETCH=1 npm run dry-render`.

### Deploy and test on AWS

1. **Build backend:** `cd backend && npm ci && npm run build`
2. **Terraform:** `cd infrastructure/terraform && terraform init && terraform apply` (use your `terraform.tfvars` with WeatherLink key/secret and station IDs)
3. **First run:** EventBridge runs the Lambda every 15 minutes. To test immediately, invoke once from AWS Console (Lambda → Test) or:  
   `aws lambda invoke --function-name lakeloui-se-orchestrator --payload '{}' out.json --region ca-west-1`
4. **Site URL:** After apply, use `terraform output cloudfront_url` (e.g. `https://xxxx.cloudfront.net`). The first Lambda run will publish `index.html` to S3 and invalidate CloudFront.

### WeatherLink API v2 (Paradise Top + Base)

The orchestrator fetches **Paradise Top** (summit) and **Base (Operations)** when their station IDs are set. Credentials and station IDs are in `infrastructure/terraform/terraform.tfvars` (gitignored).

**Find your station IDs** (from `backend/`, with credentials in env or in `backend/.env`):

```bash
cd backend && node scripts/list-weatherlink-stations.mjs
```

Then set `weatherlink_station_id` (Paradise Top) and `weatherlink_station_id_base` (Base) in `terraform.tfvars` and run `terraform apply`. For local runs: set `WEATHERLINK_API_KEY`, `WEATHERLINK_API_SECRET`, `WEATHERLINK_STATION_ID`, and `WEATHERLINK_STATION_ID_BASE` in the environment, or copy `backend/env.example` to `backend/.env` and fill in — `node run_dry_render.cjs` loads `.env` automatically so station readings are included in the render.

**Before deploy:** Ensure both station IDs are in `terraform.tfvars`; if you ever shared your API key/secret, rotate them in the WeatherLink dashboard and update tfvars.
