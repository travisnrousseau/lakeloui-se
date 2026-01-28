# Technical Specification: lakeloui.se

## 1. INFRASTRUCTURE (AWS ca-west-1)
- **Frontend:** Static S3 Bucket + CloudFront.
- **API Gateway:** Used ONLY for the `/admin` route and the Snow Phone fetch.
- **Security:** API Gateway Resource Policy whitelists SourceIP `100.64.0.0/10` (Tailscale) for the `/admin` path.
- **Database:** DynamoDB (On-Demand). Tables: `Live_Log` (15-min snapshots) and `History_Archive` (50-year backfill).

## 2. THE MONO-LAMBDA ORCHESTRATOR
- **Trigger:** EventBridge every 15 minutes.
- **Logic Sequence:**
    1. Fetch WeatherLink Pro API v2 (Paradise/Base).
    2. Fetch WaterOffice GOES (Pika/Skoki/Rivers).
    3. If 03:00 - 15:00 MST, fetch Resort XML. Check MD5 Checksum; if unchanged, skip AI processing.
    4. Validate "Groomed & Open" status for any terrain recommendations.
    5. Forecast: Clip HRDPS 2.5km GRIB2 for vertical inversion analysis.
    6. AI: Gemini 3 Flash writes the script (Winter only).
    7. Compile: Pre-render `index.html` with data/images and push to S3.

## 3. COORDINATE PINS
- **Base:** 51.443204, -116.161562
- **Paradise:** 51.460321, -116.131901
- **Pika:** 51.462086, -116.119943
- **Skoki:** 51.541860, -116.043900
