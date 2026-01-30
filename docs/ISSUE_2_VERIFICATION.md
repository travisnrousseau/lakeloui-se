# Issue #2 Verification: Canadian Weather Models (TypeScript)

Cross-check of [Issue #2 — Support Canadian Weather Models Beyond HRDPS](https://github.com/travisnrousseau/lakeloui-se/issues/2) against the current implementation in `backend/src/mscModels.ts`.

---

## Current implementation status (per revised Issue #2)

| Item | Issue #2 (revised) | Code | Status |
|------|--------------------|------|--------|
| **HRDPS** | 2.5km, 48h; West 1km for Lake Louise | `URLS.HRDPS`, `URLS.HRDPS_WEST_1KM`; `hrdpsBaseUrls()` prefers West 1km for run 00/12 | ✅ |
| **RDPS** | 10km, **max 84h** (not 10 days) | Used at 24, 36, 48h only; `FORECAST_LEADS_3H` max 48h; never >84h | ✅ |
| **GDPS** | 15km, 10 days | `URLS.GDPS`; leads 72–168h (7-day) | ✅ |
| **FireWork** | PM2.5, 2.5km | `URLS.FIREWORK`; `fetchModel("FIREWORK")`; `PointData.pm25` | ✅ |
| **No HRDPS-A** | Replaced by HRDPS West 1km | No HRDPS-A URL or logic | ✅ |
| **No ARDS** | Not a weather model | No ARDS; FireWork used for air quality | ✅ |
| **Dependencies** | vgrib2, @abasb75/jpeg2000-decoder | `package.json`: vgrib2 ^0.1.13, jpeg2000-decoder | ✅ |
| **Byte-range fetch** | Prefer .idx + Range header | `fetchGribMessage`: `.idx` → `Range: bytes=start-end`; fallback full file | ✅ |
| **COORDS** | Multiple points (BASE, PARADISE, PIKA, SKOKI) | `COORDS` in mscModels.ts | ✅ |
| **Grid** | Template 3.0 + 3.1 (rotated); geographicToRotated | `extractValueForCoord`, `geographicToRotated`; la1/lo1 normalization | ✅ |
| **PointData** | Pragmatic (temp850, temp700, temp2m, wind, pm25, precipMm) | `PointData` interface | ✅ |
| **RDPS file naming** | RLatLon0.09 | `rdpsLatLonFileName` uses RLatLon0.09 | ✅ |

---

## RDPS max range (84 hours)

- **Issue #2:** RDPS max forecast range is **84 hours (3.5 days)**, not 10 days. Requesting RDPS beyond 84h would 404.
- **Code:** We use RDPS only at **24h, 36h, 48h** in `fetchForecastTimeline` and at 3–48h (every 3h) in `fetchDetailedForecast`. All ≤ 84h. ✅

---

## Gaps (not implemented, per Issue #2)

- Model comparison API (`GET /api/weather/compare/:stationId/:validTime`)
- Weighted ensemble / `calculateWeightedForecast(weights)`
- Confidence / spread metrics (model disagreement)
- Historical model accuracy tracking
- Extended RDPS beyond 48h (optional; GDPS covers 7-day)

These are noted as future work in the issue.

---

## Why RDPS/HRDPS might show wrong values

Even when Issue #2 is satisfied, **RDPS can show implausible temps (e.g. −44°C)** and **HRDPS can show wrong temps (e.g. 7–8°C for Lake Louise in winter)** or **precipitation missing** because of:

1. **Grid interpretation (rotated lat-lon)**  
   RDPS 10km and HRDPS use GRIB2 Template 3.1 (rotated). `la1`/`lo1` are in **rotated** coordinates; we must convert Lake Louise (lat, lon) to rotated via LaD/LoV (southern pole). If vgrib2 returns LaD/LoV in the wrong scale (e.g. millidegrees not degrees) or we use geographic (lat, lon) directly, we index the wrong grid cell (e.g. Arctic → −45°C, or wrong cell → 7°C).

2. **HRDPS West 1km pole**  
   HRDPS West 1km (dd.alpha) can have vgrib2 returning LaD ~ −2114 (misread); we normalize with /1000 like RDPS, but that gives −2.114° (wrong pole). We **prefer Continental 2.5km** over West 1km so correct grid extraction is used when Continental is available.

3. **vgrib2 template 3.1 patch**  
   The repo patches vgrib2 to support Template 3.1. If the patch is not applied (e.g. fresh `npm install` without `postinstall`), RDPS/HRDPS rotated grids may be mis-parsed or LaD/LoV missing.

4. **ECCC filename or product change**  
   If ECCC changes filenames or variable names, fetches can 404 or return the wrong message.

5. **Precipitation**  
   APCP/PRATE filenames or levels (e.g. `Sfc` vs `ISBL_surface`) must match the datamart; wrong names → null precip.

**How to diagnose**

- Run **`DEBUG_FORECAST=1 npm run dry-render`** (from `backend/`) and check logs for `GRIB2 grid dump (implausible value)`: that shows `la1`, `lo1`, `dx`, `dy`, `LaD`, `LoV`, `latG`, `lonG`, `valueK`. Use it to see if rotation or scaling is wrong.
- Run **`node scripts/diagnose-rdps-grid.cjs`** (from `backend/`) for RDPS grid and **`node scripts/diagnose-hrdps-grid.cjs`** for HRDPS (Continental then West): print grid definition and sample values. Confirm LaD/LoV are in degrees and that data contains plausible temps (253–295 K).
- Force a fresh fetch: **`FORCE_FETCH=1 npm run dry-render`** so cache does not hide a fix.

---

## References

- **Implementation:** `backend/src/mscModels.ts`
- **Issue #2:** https://github.com/travisnrousseau/lakeloui-se/issues/2
- **ECCC RDPS datamart:** https://eccc-msc.github.io/open-data/msc-data/nwp_rdps/readme_rdps-datamart_en/
- **GRIB2 format:** https://www.nco.ncep.noaa.gov/pmb/docs/grib2/
