# lakeloui.se — Project status

**Last updated:** 2025-01-29. What’s done vs what’s left (by area).

---

## Done

### Backend & data pipeline
- **Mono-Lambda orchestrator** (Node 22 + TypeScript): EventBridge every 15 min; fetches, renders, writes to DynamoDB and S3.
- **WeatherLink v2:** Paradise Top + Base; credentials from Lambda env (Terraform → `terraform.tfvars` / `backend/.env`).
- **GeoMet (Canadian models):**
  - HRDPS, RDPS, GDPS via WMS GetFeatureInfo (WCS-style layer names); no GRIB2/vgrib2.
  - **Request optimization:** GetCapabilities used to request only forecast leads GeoMet actually provides.
  - **Hash check:** SHA-256 of forecast payload vs `FRONTEND_META.lastGeometHash`; reuse previous snapshot when unchanged (skip redundant processing and DDB writes).
  - **“Now” continuity:** Merge new fetch with previous snapshot so missing 0h/3h etc. are filled from last run; full fallback to previous forecast if GeoMet fetch fails.
- **WaterOffice GOES:** Bow, Pipestone, Louise Creek (WaterOffice API). **Pika Run & Skoki** (GOES-18) are fetched separately from **Alberta River Basins** (ACIS) in `backend/src/pikaSkoki.ts`; see DATA_SOURCES §2 (High-Alpine Monitoring). On the dashboard they appear in the **"Pika & Skoki (GOES-18)"** card (template §SNOW_REPORT_CARD); if the fetch fails or returns no data, the card shows "—" for both rows.
- **Resort XML:** 03:00–15:00 MST; MD5 hash check to skip AI when unchanged.
- **Townsite:** Code present; EC 3053759 not in SWOB/climate-hourly — disabled, doc’d as backup only.
- **DynamoDB:** Live_Log (LIVE_SNAPSHOT, FRONTEND_META, RESORT_META, etc.); index hash → S3 PUT + CloudFront invalidation only when content changes.
- **Pre-rendered HTML:** Single `index.html` with all data; Midnight Alpine styling.

### Cleanup (completed)
- American models (NOAA NAM/GFS) and `noaaModels.ts` removed.
- GeoMet EDR client removed (was 404).
- GRIB2/vgrib2, JPEG2000 decoder, patch-package removed; Canadian models via GeoMet only.
- `mscModels.ts` reduced to types only (`ForecastPeriod`, `DetailedForecast`).

### Infrastructure
- **Terraform (ca-west-1):** S3 frontend bucket, CloudFront, DynamoDB (Live_Log, History_Archive), Lambda, EventBridge, API Gateway.
- **Custom domain wx.lakeloui.se:** Variables, ACM (us-east-1), DNS validation, Route 53 A record; conditional on `route53_zone_id` in tfvars.
- **terraform.tfvars:** Domain + Route 53 zone ID set; WeatherLink populated from `backend/.env` via `infrastructure/terraform/populate-tfvars-from-env.sh`.

### Docs & tooling
- ARCHITECTURE, CONTENT_LOGIC, GEOMET_STRATEGY, **MODELS_ROCKIES_OPERATIONS** (why HRDPS/RDPS/GDPS for Rockies ski ops—resolution, orographic lift, wind channelling, Chinook, freezing level); README and infra README with deploy + custom-domain steps.
- Local run: `backend`: `npm run dry-render` / `dry-render:open`; repo: `scripts/fetch-and-render.sh`.
- `populate-tfvars-from-env.sh` syncs WeatherLink from `backend/.env` into `terraform.tfvars`.

---

## Still to do (by priority)

### 1. Go live / DNS — **done**
- **Apply Terraform with custom domain:** Completed. ACM cert (wx.lakeloui.se), DNS validation, Route 53 A record, CloudFront alias + custom cert, Lambda env (WeatherLink from tfvars) are in place.
- **Verify:** Open **https://wx.lakeloui.se** (or `terraform output frontend_url`). Dashboard appears after first Lambda run (EventBridge every 15 min, or invoke once: `aws lambda invoke --function-name lakeloui-se-orchestrator --payload '{}' out.json --region ca-west-1`).

### 2. Content logic & AI (from CONTENT_LOGIC / ARCHITECTURE)
- **Stash Finder / Groomer Check:** Validate “Groomed & Open” from resort data and gate any terrain recommendations.
- **AI script (Winter):** ARCHITECTURE mentions “Gemini 3 Flash writes the script”; confirm if/when this is wired (e.g. Resort XML change → trigger, env/keys).
- **Inversion / orographic / Chinook / freezing level:** Logic is doc’d in CONTENT_LOGIC; confirm it’s fully implemented in handler/render and that GeoMet-derived fields (e.g. 850/700 mb) are passed through.

### 3. Frontend evolution (ARCHITECTURE “Build out later”)
- **JSON output:** Lambda writes same payload as `data.json` to S3; frontend can stay HTML-first but add fetch of `data.json` for auto-refresh or extra views.
- **frontend/ (Vite + Alpine):** Currently minimal (index, main.js/css). When ready: shell page + load `data.json`, multiple views, optional polling.

### 4. History & backfill
- **History_Archive:** Table exists in Terraform; orchestrator does **not** write to it yet. Intended for long-term archive.
- **Python backfill (scripts/):** ARCHITECTURE/README mention Python 3.12 for EC/ACIS archives; no backfill job in repo yet. Add when needed for historical series.

### 5. Scripts / README tidy
- **scripts/README.md:** Still references vgrib2, GRIB2, `VGRIB2_DEV_PATH`, and “Models (GRIB2)”. Update to GeoMet-only and current cache/env (e.g. `FORCE_FETCH`, `DEBUG_GEOMET` if used).

### 6. Optional / later
- **API:** “Latest from DB” or time-range API (e.g. API Gateway + Lambda on Live_Log) if you want non–HTML consumers.
- **FireWork:** Doc’d in CONTENT_LOGIC; add to GeoMet/model pipeline if smoke/air quality is in scope.
- **EDR:** GEOMET_STRATEGY says use EDR when api.weather.gc.ca exposes those collections; revisit when available.

---

## Quick reference

| Area              | Status | Notes |
|-------------------|--------|--------|
| WeatherLink       | Done   | Paradise + Base; tfvars from .env script |
| GeoMet (HRDPS/RDPS/GDPS) | Done | Optimized leads, hash skip, “now” merge/fallback |
| WaterOffice GOES  | Done   | Pika/Skoki/Rivers |
| Resort XML        | Done   | 3am–3pm MST, MD5 skip |
| Live_Log + S3/CF  | Done   | Hash-driven publish |
| wx.lakeloui.se    | Done   | Live at https://wx.lakeloui.se |
| Stash/Groomer + AI | To verify | Logic in CONTENT_LOGIC; Gemini wiring |
| data.json + frontend app | Later | ARCHITECTURE “build out later” |
| History_Archive write | Not started | Table exists; backfill/archive TBD |
| Python backfill  | Not started | EC/ACIS when needed |
