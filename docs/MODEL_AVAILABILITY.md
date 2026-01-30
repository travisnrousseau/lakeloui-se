# When to Expect Weather Models (MST)

**American models (NAM, GFS) are currently disabled.** The dashboard does not fetch NOAA NOMADS data. Canadian models (HRDPS, RDPS, GDPS) are also not fetched. The 48H forecast bento will show fixture or empty data until a model source is re-enabled.

---

## NOAA NAM (CONUS Nest, ~3 km) — **disabled**

- **Runs:** 00Z, 06Z, 12Z, 18Z. Code uses ~3h delay after run time.
- **Forecast range:** 6–48h (leads 6, 12, 18, 24, 36, 48).
- **Source:** NOMADS NCEP `filter_nam_conusnest.pl` with subregion around Lake Louise.
- **Data:** 2 m temperature (single point); subregion minimizes transfer.
- **Decode:** vgrib2 with Template 3.30 (Lambert Conformal) support; minimal subregion uses a single-value GRIB2 decode when grid/data is empty.

---

## NOAA GFS (0.25° global) — **disabled**

- **Runs:** 00Z, 06Z, 12Z, 18Z. Same ~3h delay.
- **Forecast range:** 6–48h for table comparison; 72–168h for extended trend.
- **Source:** NOMADS NCEP `filter_gfs_0p25.pl` with subregion.
- **Extended (7-day) trend** uses GFS 72–168h.

---

## ECCC models (deprecated — no longer fetched)

The following notes are kept for reference only. The dashboard **does not** fetch these anymore.

### HRDPS (2.5 km continental)

- **Runs:** 00Z and 12Z only (code uses conservative “West 1km” timing).
- **00Z run** (model from **5 PM MST** previous day): expect data **from ~11 PM MST** (same evening) until noon next day.
- **12Z run** (model from **5 AM MST**): expect data **from ~12 noon MST** until late evening.

So in MST you get a fresh run **around noon** (12Z) and again **around 11 PM** (00Z). Between ~11 PM and ~noon you see the 00Z run; between ~noon and ~11 PM you see the 12Z run.

---

## RDPS (10 km regional)

- **Runs:** every 6 hours (00Z, 06Z, 12Z, 18Z). Code uses a **5-hour delay** after run time before assuming the run is published.
- **Datamart behaviour:** `/today/model_rdps/10km/` contains **only the single latest run** (e.g. at 03 UTC only `00/` is present). The code uses `getLatestRdpsRun()` so the requested run matches what is in `/today/` (run = current 6h block: 00 for 0–5 UTC, 06 for 6–11 UTC, etc.). Older runs are not under `/today/`; requesting them caused 404s before this fix.
- **Extraction:** RDPS 10km rotated lat-lon uses GRIB2 template 3.1; vgrib2 often returns wrong LaD/LoV (e.g. -2115, 267). The code tries known ECCC poles and both index orders. If extraction still yields implausible temps (e.g. &lt; -30°C for Lake Louise), the code returns no value so the UI shows **"—"** instead of wrong data. Correct pole/rotation for RDPS rotated grid is still under investigation.
- **00Z** (5 PM MST prev day) → available **~10 PM MST**
- **06Z** (11 PM MST prev day) → available **~4 AM MST**
- **12Z** (5 AM MST) → available **~10 AM MST**
- **18Z** (11 AM MST) → available **~4 PM MST**

So in MST you can expect a new RDPS run roughly every 6 hours: **~10 PM, ~4 AM, ~10 AM, ~4 PM** (plus/minus an hour).

---

## GDPS (15 km global)

- **Runs:** every 12 hours (00Z, 12Z). Same 5-hour delay.
- **00Z** → available **~10 PM MST**
- **12Z** → available **~10 AM MST**

---

## Summary (MST)

| Source | Status |
|--------|--------|
| **NAM / GFS** | **Disabled** — not fetched |
| ECCC via GeoMet (HRDPS, GDPS) | **Optional** — set `GEOMET_ENABLED=1` to fetch |

**Canadian models via GeoMet (locally):**

- Dry-run: `GEOMET_ENABLED=1 npm run dry-render` or `GEOMET_ENABLED=1 FORCE_FETCH=1 node run_dry_render.cjs`
- Lambda: set env `GEOMET_ENABLED=1` (or `true`) to fetch HRDPS/GDPS from GeoMet WCS (netCDF point subset).

See **`docs/GEOMET_STRATEGY.md`** for coverage IDs and netCDF parsing.

To re-enable American models: set `NOAA_DISABLED = false` in `run_dry_render.cjs` and restore the NOAA fetch block in `handler.ts`.

---

## Check extraction locally

From the **backend** directory:

```bash
npm run dry-render
```

Output is in `/tmp/lakeloui_live_dry_index.html`. The handler fetches NAM and GFS from NOMADS; if NOMADS is slow or returns 404, forecast cells may show —. `npm run check-forecast` (if present) targeted ECCC; for NOAA, use dry-render or invoke the Lambda.

---

## Datamart URLs (fixed Jan 2026)

The dashboard uses **dd.weather.gc.ca** with **/today/** in the path for HRDPS, RDPS, and GDPS. RDPS rotated lat-lon: `https://dd.weather.gc.ca/today/model_rdps/10km/{HH}/{hhh}/` with filenames `YYYYMMDDTHHZ_MSC_RDPS_*_RLatLon0.09_PThhhH.grib2`. For RDPS, `/today/` exposes only the **current** run (e.g. at 03 UTC only run `00`); the code requests that run via `getLatestRdpsRun()` to avoid 404s. If 404s persist, the code falls back to dd.meteo.gc.ca and to paths without `/today/`.
