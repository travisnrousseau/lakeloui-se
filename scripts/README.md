# Scripts — Historical backfill & one-off tooling

- **Historical backfill:** Python 3.12 for EC and ACIS archives (see CONTENT_LOGIC §III, ARCHITECTURE).
- Add job scripts and helpers here.

## Automated fetch & render

**One command (from repo root):**
```bash
./scripts/fetch-and-render.sh
```

**From backend only:**
```bash
cd backend && npm run dry-render
```

This builds the backend (if needed), then **fetches only sources whose cache is stale** (per-source max age):

| Source | Default max age | Rationale |
|--------|------------------|-----------|
| **WeatherLink** | 15 min | Stations every 15 min |
| **Water** (WaterOffice) | 2 h (120 min) | GOES stations report every 1–6 h |
| **Models** (MSC + forecast GRIB2) | 5 h (300 min) | ECCC runs: RDPS ~6 h, HRDPS/GDPS ~12 h |
| **Townsite** | **Disabled** | EC station 3053759 not in SWOB/climate-hourly; see `backend/src/townsite.ts`. Never fetched. |
| **Resort** (ski XML) | 15 min, **3am–3pm local only** | Fetched every 15 min in window; **hash compared** to cached `xmlHash` — if unchanged, cached data reused. Outside 3am–3pm, cache only. |

Cache is stored in `backend/fixtures/dry-run-cache.json` with per-source timestamps. Each run fetches only what’s stale; the rest is read from cache (good-neighbor to WeatherLink, ECCC, WaterOffice, resort).

Output:
- `/tmp/lakeloui_live_dry_index.html` and `/tmp/lakeloui_test_index.html`
- `backend/fixtures/cached-forecast.json` (for test_render; only when models were fetched)

**Env (optional, all in minutes except where noted):**
- `MAX_CACHE_AGE_WEATHERLINK=15` — WeatherLink (default 15).
- `MAX_CACHE_AGE_WATER=120` — WaterOffice (default 120).
- `MAX_CACHE_AGE_MODELS=300` — MSC + forecast GRIB2 (default 300).
- Townsite has no env (disabled).
- Resort: fixed 15 min in 3am–3pm local window; hash check avoids reusing unchanged XML.
- `FORCE_FETCH=1` — ignore cache and fetch all sources once (resort still only fetched in 3am–3pm unless you change code).
- `DEBUG_FORECAST=1` — log GRIB2 decode/JPEG2000 errors and grid-edge lookups (noisy).
- **Models (GRIB2):** Dry render sets `NODE_ENV=development` and `VGRIB2_DEV_PATH` to `backend/node_modules/vgrib2/dist/vgrib2.cjs.development.js` so the Bento forecast uses the vgrib2 build that supports Template 5.40 (JPEG2000). If model temps are missing, check that postinstall ran (template540 in vgrib2 dev build) and that ECCC URLs are reachable (404s → fixture fallback for display).

**Hash for other sources?** Resort uses `xmlHash` (MD5 of response) so we only update when content changes. The same pattern could be applied to WeatherLink, water, or models (e.g. hash response and skip updating cache when unchanged); not implemented for others yet.

**Cron (e.g. every 15 min):** WeatherLink refreshes every 15 min; models/water/resort only when their cache window has passed.
```cron
*/15 * * * * /home/travis/Code/lakeloui-se/scripts/fetch-and-render.sh >> /tmp/lakeloui-fetch.log 2>&1
```
