# Technical Specification: lakeloui.se

## 1. INFRASTRUCTURE (AWS ca-west-1)
- **Frontend:** Static S3 Bucket + CloudFront.
- **API Gateway:** Used ONLY for the `/admin` route and the Snow Phone fetch.
- **Security:** API Gateway Resource Policy whitelists SourceIP `100.64.0.0/10` (Tailscale) for the `/admin` path.
- **Database:** DynamoDB (On-Demand). Tables: `Live_Log` (15-min snapshots) and `History_Archive` (50-year backfill).

## 2. THE MONO-LAMBDA ORCHESTRATOR
- **Trigger:** EventBridge every 15 minutes (lower cost; S3 PUT + CloudFront invalidation only when content hash changes).
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
