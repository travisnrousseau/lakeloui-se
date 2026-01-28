# lakeloui.se — Trav's Weather Dashboard

Honest, independent "Where & Why" weather and snow report for Lake Louise. Mountain-guide tone, scale-to-zero AWS (ca-west-1).

## Specs

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Infrastructure, Mono-Lambda orchestrator, coordinate pins.
- **[docs/CONTENT_LOGIC.md](docs/CONTENT_LOGIC.md)** — Stash Finder, Groomer Check, operational gates, forecast model consensus.

## Stack (target)

- **Frontend:** S3 + CloudFront, Alpine.js + Vite, semantic HTML, Midnight Alpine UI.
- **Backend:** Node.js 24 + TypeScript Mono-Lambda (EventBridge every 15 min).
- **Data:** WeatherLink, GOES, Resort XML; DynamoDB `Live_Log` + `History_Archive`.
- **Infra:** Terraform. Historical backfill: Python 3.12 (EC/ACIS).

## Repo layout

```
backend/         # Mono-Lambda orchestrator (Node 24 / TS)
frontend/       # Alpine.js + Vite static site
infrastructure/ # Terraform (AWS ca-west-1)
scripts/        # Historical backfill (Python 3.12), one-off tooling
docs/           # ARCHITECTURE, CONTENT_LOGIC
flake.nix       # Dev env: Terraform, Node 24, AWS CLI, Python 3.12
```

## Development

Enter the Nix dev shell (Terraform, Node.js 24, AWS CLI, Python 3.12):

```bash
nix develop
```

Before first Terraform apply: `cd backend && npm ci && npm run build`.
