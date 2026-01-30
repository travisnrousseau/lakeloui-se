# Technical Specification: lakeloui.se

## 1. INFRASTRUCTURE (AWS ca-west-1)
- **Frontend:** Static S3 Bucket + CloudFront.
- **API Gateway:** Used ONLY for the `/admin` route and the Snow Phone fetch.
- **Security:** API Gateway Resource Policy whitelists SourceIP `100.64.0.0/10` (Tailscale) for the `/admin` path.
- **Database:** DynamoDB (On-Demand). Tables: `Live_Log` (15-min snapshots) and `History_Archive` (50-year backfill). See §5 (Data retention) for how long data is kept.

## 2. THE MONO-LAMBDA ORCHESTRATOR
- **Trigger:** EventBridge every 15 minutes (lower cost; S3 PUT + CloudFront invalidation only when content hash changes). The dashboard updates throughout the day on this schedule.
- **DynamoDB:** Each run writes a full snapshot to `Live_Log` (pk `LIVE_SNAPSHOT`, sk = ISO timestamp): weather, forecast (timeline + detailed HRDPS/RDPS/GDPS with temps and precip), resort, snow report, etc. Hash for `index.html` is stored in `FRONTEND_META`/`INDEX_HASH` so S3/CloudFront are only updated when content changes.
- **GEOMET_ENABLED=1** (Lambda env): Canadian models (HRDPS, RDPS, GDPS) are fetched every run; forecast (including snow/precip per lead) is included in the snapshot and in the rendered HTML.
- **Sensors = what is; models = what could be.** WeatherLink and WaterOffice are ground truth (inversion, temp, wind, bar, discharge). HRDPS/RDPS/GDPS/FireWork are forecast and context (inversion aloft, orographic lift, Chinook, freezing level, smoke).
- **Logic Sequence:**
    1. Fetch WeatherLink Pro API v2 (Paradise/Base) — sensors, what is.
    2. Fetch WaterOffice GOES (Bow 05BA001, Pipestone 05BA002, Louise Creek 05BA004); Pika/Skoki via ACIS & Alberta River Basins when fetcher added. Townsite (EC 3053759) is left in code only — does not work, not planned; do not use or use as fallback (see DATA_SOURCES §2 Valley-Floor).
    3. If 03:00 - 15:00 MST, fetch Resort XML. Check MD5 Checksum; if unchanged, skip AI processing.
    4. Validate "Groomed & Open" status for any terrain recommendations.
    5. Models (what could be): Clip HRDPS 2.5km GRIB2 for:
       - **Inversion analysis:** 850mb vs 700mb temperatures (inversion strength).
       - **Orographic lift:** 700mb wind direction/speed (≥16 km/h = enhancement).
       - **Chinook detection:** W/SW wind + rapid temp rise + humidity drop.
       - **Freezing level:** Temperature profile (interpolate 0°C altitude).
       - **Valley winds:** Surface wind speed (local vs synoptic dominance).
    6. AI: Gemini 3 Flash writes the script (Winter only).
    7. Compile: Pre-render `index.html` with data/images. If SHA-256 hash equals last (DDB `FRONTEND_META`/`INDEX_HASH`), skip S3 PUT and CloudFront invalidation; else PUT to S3, create CloudFront invalidation for `/index.html` and `/`, then save hash.

## 3. COORDINATE PINS
- **Base:** 51.443204, -116.161562
- **Paradise:** 51.460321, -116.131901
- **Pika:** 51.462086, -116.119943
- **Skoki:** 51.541860, -116.043900

## 4. BUILD OUT LATER
When expanding the site (more pages, auto-refresh, app-like UI):
- **Hybrid:** Have the Lambda also write the same payload as **JSON** to S3 (e.g. `data.json`). Keep serving the current pre-rendered HTML as the main page. Then evolve the frontend (e.g. `frontend/` Vite + Alpine) into the real site: shell + fetch `data.json` and render. Enables multiple views, auto-refresh (poll JSON), and reuse of data elsewhere.
- **Optional:** If you need “latest from DB” or time-range queries, add a small API (e.g. API Gateway + Lambda) that reads from Live_Log and returns JSON.
- Current HTML-first design does not block this; add JSON output when ready.

## 5. Data retention (DynamoDB)

- **Live_Log — `LIVE_SNAPSHOT` (pk) + ISO timestamp (sk):** Full snapshot every 15 min (weather, forecast, resort, snow report, AI script, etc.). **TTL = 7 days.** You can look back about a week; older snapshots are deleted by DynamoDB TTL.
- **Live_Log — `AI_REPORT` (pk) + ISO timestamp (sk):** When the AI runs, a summary row is written (aiScript, stashName, inversionActive, etc.). **TTL = 1 year.** So AI report history is queryable for up to a year.
- **Live_Log — `FRONTEND_META`:** No TTL; small metadata (GEOMET_HASH, INDEX_HASH) kept indefinitely.
- **History_Archive:** Table exists in Terraform; the orchestrator **does not write to it yet**. Intended for long-term archive (e.g. backfill or copy of snapshots for multi-year lookback). To look back months or years, see §6 below.

## 6. Recommended: long-term lookback (“check stuff in the future”)

**Implemented:** An S3 **archive bucket** (`archive` in Terraform; name like `lakeloui-se-archive-{env}-{account}`) with **lifecycle: after 180 days move objects to Glacier** (Flexible Retrieval). The Lambda writes each 15-min snapshot to `snapshots/YYYY/MM/DD/snapshot-{iso}.json` when `ARCHIVE_BUCKET` is set (same payload as Live_Log). So you keep full history for year-over-year comparison.

**Comparing previous years:** Data is kept indefinitely. Objects in the first 180 days are in S3 Standard; older ones are in Glacier. To compare e.g. Jan 2026 vs Jan 2027:
- **Recent (< 180 days):** List and download directly: `aws s3 ls s3://<archive-bucket>/snapshots/2026/01/` then `aws s3 cp s3://.../snapshot-2026-01-15T12-00-00.000Z.json .`
- **Older (in Glacier):** Initiate restore (Standard 3–5 hr or Bulk for many objects), then download once restore completes. In the console: select object(s) → Actions → Initiate restore; or use `aws s3api restore-object` with `GlacierJobParameters`. After restore, GET/cp as usual. Bulk restore is cheap when pulling a whole month for comparison.

**Summary:** S3 archive + 180-day transition to Glacier keeps storage cheap while keeping all data available for year-over-year review. The orchestrator writes every run when `ARCHIVE_BUCKET` is set.
