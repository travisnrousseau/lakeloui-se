# GeoMet Strategy: EDR / WMS / WCS for Canadian Models

**Why these models for a Rockies ski resort:** See [MODELS_ROCKIES_OPERATIONS.md](MODELS_ROCKIES_OPERATIONS.md) (resolution, orographic lift, wind channelling, Chinook, freezing level, which model for which metric).

**TL;DR:** The app uses **WMS GetFeatureInfo first** with **WCS-style layer names** (e.g. `HRDPS-WEonG_2.5km_AirTemp`), then falls back to **WCS GetCoverage + netCDF**. EDR (`HRDPS.CONTINENTAL_TT` etc.) still returns 404; use EDR when api.weather.gc.ca exposes those collections.

---

## 1. RDPS and GDPS Layer Names (MSC GeoMet)

### RDPS (Regional Deterministic Prediction System)

- **Purpose:** Mid-range specialist (bridge between HRDPS and GDPS).
- **Resolution:** 10 km (vs HRDPS 2.5 km).
- **Range:** Out to 84 hours.
- **Why for Lake Louise:** Better at large moisture plumes (atmospheric rivers) off the Pacific.
- **Temperature:** We query **base** and **summit** grid cells separately (`RDPS.ETA_TT` at BASE lat/lon and Paradise lat/lon) and use the two 2 m temps directly (no lapse correction). A single point at base + lapse from a fixed 2071 m reference was wrong: the 10 km cell at base often represents valley/warmer air, so RDPS row was showing positive temps when they should be negative; using the summit cell gives a colder, mountain-representative value.

**Layer names** (prefix `RDPS.CONTINENTAL_`):

| Variable        | Layer ID                 |
|-----------------|---------------------------|
| Temperature     | `RDPS.CONTINENTAL_TT`     |
| Precipitation   | `RDPS.CONTINENTAL_PR`     |
| Wind Speed      | `RDPS.CONTINENTAL_WND`    |

### GDPS (Global Deterministic Prediction System)

- **Purpose:** Long-range (Canadian GFS).
- **Resolution:** 25 km.
- **Range:** Out to 10 days (240 h).
- **Why for Lake Louise:** 7-day outlook; cold fronts from the Arctic.

**Layer names** (prefix `GDPS.CONTINENTAL_`):

| Variable   | Layer ID                 |
|------------|---------------------------|
| Temperature| `GDPS.CONTINENTAL_TT`     |
| Snow Depth | `GDPS.CONTINENTAL_SNDP`   |

### HRDPS (Short-term 0–48 h)

- **Temperature:** `HRDPS.CONTINENTAL_TT`
- **Precipitation:** `HRDPS.CONTINENTAL_APCP` (total precip; use TMP to decide rain vs snow).

---

## 2. WMS GetFeatureInfo (Point = “click” on one pixel)

Easiest way to get point data without GRIB parsing: request the value at one pixel.

**URL pattern:**

```
https://geo.weather.gc.ca/geomet?
SERVICE=WMS&
VERSION=1.3.0&
REQUEST=GetFeatureInfo&
LAYERS={LAYER_NAME}&
QUERY_LAYERS={LAYER_NAME}&
BBOX=51,-117,52,-116&
FEATURE_COUNT=1&
I=50&J=50&
WIDTH=100&HEIGHT=100&
INFO_FORMAT=application/json&
CRS=EPSG:4326
```

- **LAYER_NAME:** Use **WCS-style names** (same as WCS coverage IDs): `HRDPS-WEonG_2.5km_AirTemp`, `GDPS_15km_AirTemp_2m`, `GDPS-GEML_25km_AirTemp_2m`. Names like `RDPS.CONTINENTAL_TT` return "Layer not available".
- **BBOX:** Small box around Lake Louise.
- **I, J:** Pixel in that virtual map (50,50 = center of 100×100).

**Implementation:** `backend/src/geometClient.ts` tries WMS GetFeatureInfo first (with WCS-style layer names), then falls back to WCS+netCDF. This avoids 404s and returns JSON with `properties.value` directly.

---

## 3. OGC API - EDR (Position query, time-series + elevation)

**Base:** `https://api.weather.gc.ca` (or see GeoMet docs for EDR root).

**Position URL example (Lake Louise):**

```
https://api.weather.gc.ca/collections/HRDPS.CONTINENTAL_TT/position?coords=POINT(-116.17%2051.42)&f=json
```

- **coords:** `POINT(lon lat)` (GeoJSON order).
- **Response:** GeoJSON with `features[0].properties.values` (array of values), `properties.datetime` (timestamps), and `geometry.coordinates[2]` = **elevation (m)** for that cell.

**Why this is better:**

1. **Elevation:** `geometry.coordinates[2]` gives model cell elevation. If summit is 2630 m and model says 2100 m, apply lapse in TS:  
   `finalTemp = modelTemp - (530 * 0.0065);`
2. **No rotated-pole math:** Server does the work; you get a result for the coordinate you asked for.
3. **Same pattern:** One function for HRDPS, RDPS, GDPS by changing the layer prefix.

**Note:** When tested, `api.weather.gc.ca/collections/HRDPS.CONTINENTAL_TT` returned 404 "Collection not found". Code: `backend/src/geometEdr.ts` (`fetchEdrPosition`, `getEdrTemp2m`).

---

## 4. Current Implementation: WMS GetFeatureInfo first, then WCS + netCDF

The app **tries WMS GetFeatureInfo** with the same layer names as WCS (e.g. `HRDPS-WEonG_2.5km_AirTemp`). If that returns JSON with a numeric `value`, that value is used. Otherwise it **falls back to WCS 2.0.1 GetCoverage** with a small bbox and **FORMAT=image/netcdf**, then parses the netCDF in Node (`netcdfjs`).

**WCS/WMS layer IDs that work:**

| Model | Layer / Coverage ID (2 m / AirTemp)        |
|-------|-------------------------------------------|
| HRDPS | `HRDPS-WEonG_2.5km_AirTemp`               |
| HRDPS precip | `HRDPS-WEonG_2.5km_TotalPrecipitation` (mm liquid) |
| HRDPS wind | `HRDPS-WEonG_2.5km_WindSpeed`, `HRDPS-WEonG_2.5km_WindDir` (GetCapabilities: no _10m suffix; speed m/s→km/h, dir °). We add +180° to direction so display matches SpotWX (GeoMet raw is opposite). |
| RDPS  | `RDPS.ETA_TT` (WMS; value at ~2071 m ref)  |
| RDPS precip | `RDPS.ETA_PR` (mm liquid) |
| RDPS wind (10 m) | `RDPS_10km_WindSpeed_10m`, `RDPS_10km_WindDir_10m` (GetCapabilities uses WindDir not WindDirection). Used as-is to match SpotWX (no 180° correction). |
| RDPS wind (80 m, summit) | `RDPS_10km_WindSpeed_80m`, `RDPS_10km_WindDir_80m` — used for RDPS row at summit (ridge-level); fallback to 10 m at base if 80 m unavailable. As-is, no 180°. |
| GDPS  | `GDPS_15km_AirTemp_2m` or `GDPS-GEML_25km_AirTemp_2m` |
| GDPS precip | `GDPS_15km_Precip-Accum3h` (3h accumulation, mm liquid; no TotalPrecipitation layer in GeoMet for 15km). |
| GDPS wind (10 m) | `GDPS_15km_Winds_10m` (single combined layer; GetFeatureInfo may return speed and direction as multiple bands). Used as-is (no 180° correction). |

RDPS is fetched via WMS GetFeatureInfo with layer `RDPS.ETA_TT`; base/summit are lapse-corrected from 2071 m (see §5.3).

- **File:** `backend/src/geometClient.ts` (WMS GetFeatureInfo first, optional TIME for forecast hour, then WCS + netCDF parse; `getRdpsTemp2m`).
- **Forecast:** `backend/src/geometForecast.ts` (HRDPS 0–24 h, RDPS lapse from 2071 m per lead, GDPS 36–48 h). Each lead is fetched with WMS TIME = valid time (reference run + lead) so values match SpotWx-style hourly; leads 0h and 3h included for “closer to now”.

---

## 5. Base vs Summit and Lapse Rate

```typescript
const LOCATIONS = {
  LOUISE_BASE:   { name: "Lake Louise Resort Base",   lat: 51.441, lon: -116.155, elevation: 1640 },
  LOUISE_SUMMIT: { name: "Top of World / Summit",     lat: 51.465, lon: -116.115, elevation: 2630 },
};
```

**Elevation adjustment:** If the model’s cell elevation (e.g. from EDR `geometry.coordinates[2]`) differs from the site:

- Standard lapse: **−0.0065 °C/m**.
- `adjustedTemp = modelTemp + (modelElev - actualElev) * 0.0065`

### 5.1 Picking a higher-elevation cell for summit

**Yes, it’s worth it.** Using a cell whose terrain elevation is closer to 2630 m gives a better summit temp (less lapse-rate error). WMS GetFeatureInfo does **not** return cell elevation—only the raster value (temp). So we can’t “pick by elevation” from the WMS response alone.

**What we do:** Sample a 3×3 grid of points around the summit (Paradise) coordinates, get **terrain elevation** at each from an external source (Open-Elevation API), and choose the (lat, lon) whose elevation is **closest to 2630 m**. We then query GeoMet for temp at that (lat, lon). That way the model cell we use is at representative summit altitude.

- **Code:** `backend/src/elevation.ts` (`getSummitPointForTemp`); used by `geometForecast.ts` and `scripts/check-geomet-local.cjs`.
- **Fallback:** If elevation lookup fails, we use the nominal summit (Paradise) coordinates.
- **EDR:** When EDR is available, it returns `geometry.coordinates[2]` = cell elevation, so we could pick by elevation or apply lapse-rate without a separate DEM.

### 5.2 GDPS: anchored at summit, base lapse-corrected (elevation + PBL)

GDPS is 15–25 km resolution, so base (1650 m) and summit (2630 m) often fall in the **same coarse cell**. We anchor on the **summit** (closer to actual conditions at elevation) and lapse-correct **down** to base:

- **Query:** GDPS at summit (elevation-optimized point) only.
- **Summit temp:** Raw value from GeoMet (direct).
- **Base temp:** Lapse-corrected from summit: `baseTemp = summitTemp + (elevSummitM - elevBaseM) * 0.0065`.

Lapse rate −0.0065 °C/m (dry adiabatic / PBL). This keeps summit “almost perfect to actual” and derives base from it.

- **Code:** `backend/src/geometForecast.ts` (`lapseCorrectBase`, `LAPSE_RATE_PER_M`).

### 5.3 RDPS: correct from reference elevation (2071 m)

RDPS 2 m temp is at **2071 m** reference elevation (model cell). We fetch RDPS via GeoMet WMS layer **`RDPS.ETA_TT`** (one value at base coords), then correct to base (1650 m) and summit (2630 m):

- **Formula:** `baseTemp = rdpsTemp + (2071 - 1650) * 0.0065`; `summitTemp = rdpsTemp + (2071 - 2630) * 0.0065`.
- **Code:** `backend/src/geometClient.ts` (`getRdpsTemp2m`, layer `RDPS.ETA_TT`); `backend/src/geometForecast.ts` (`RDPS_REF_ELEV_M = 2071`, `lapseCorrectFromRef`).

### 5.4 PBL and inversions (using PBL for everything to see inversions)

**Can we use the planetary boundary layer for everything so as to see inversions?**

- **Inversions** = temperature increasing with height (summit warmer than base). A fixed lapse rate (−0.0065 °C/m) always makes summit colder than base, so we **cannot** show inversions when we derive one level from the other.

**Current behaviour:**

| Model | How we get base/summit | Can show inversion? |
|-------|------------------------|----------------------|
| **HRDPS** | Two separate grid cells (base point, elevation-optimized summit point). No lapse applied. | **Yes.** If the model has summit &gt; base, we display it. |
| **RDPS** | One value at 2071 m, lapse to base and summit. | No. Summit is always colder than base by construction. |
| **GDPS** | One value at summit, lapse down to base. | No. Base is always warmer than summit by construction. |

**To use PBL “for everything” and see inversions everywhere we’d need:**

1. **Vertical profile or multi-level temperature**  
   HRDPS/RDPS have many vertical levels in GRIB2 (31/33). If GeoMet (or another API) exposed temperature at several heights (e.g. 1650 m, 2071 m, 2630 m) or on pressure levels, we could interpolate to base and summit and **not** apply a lapse—inversions would show up naturally when summit &gt; base.

2. **PBL height layer**  
   If GeoMet exposed a PBL height product, we could use it to choose lapse rate (e.g. different lapse below vs above PBL, or no lapse within a shallow PBL). No standard PBL layer was clearly documented in the GeoMet WCS/WMS docs; worth checking `GetCapabilities` for names like `PBL`, `boundary layer`, or `height`.

3. **Stability-based lapse**  
   Use low-level stability (e.g. 2 m vs 950 mb temp) to switch between “normal” lapse and “inversion” (e.g. zero or positive lapse). Would require at least one extra level from the model.

**Practical next step:** **Discovery:** Run `npm run list-geomet-pbl` (script `backend/scripts/list-geomet-pbl-capabilities.mjs`) to list WCS/WMS layers matching pbl, height, vertical, level, boundary, profile. PBL-specific layers found: `CAPS_3km_PlanetaryBoundaryLayerHeight`, `GDPS.ETA_HPBL`, `GDPS_15km_PlanetaryBoundaryLayerHeight`, `HRDPS.CONTINENTAL_HPBL`, `RDPS.ETA_HPBL`, **`RDPS_10km_PlanetaryBoundaryLayerHeight`** (RDPS PBL height, 10 km). Use these for PBL-aware lapse: fetch PBL height at point; if summit &gt; PBL height, use different lapse or no lapse above PBL so RDPS/GDPS can show inversions. (Original: Query GeoMet WCS GetCapabilities for layers containing “PBL”, “height”, “vertical”, or “level” to see if multi-level or PBL data is available; if so, we could add optional profile-based base/summit and use that path to show inversions for RDPS/GDPS as well.

### 5.5 PBL height layers (GeoMet)

| Model | PBL height layer (WCS / WMS) |
|-------|------------------------------|
| HRDPS | `HRDPS.CONTINENTAL_HPBL` |
| **RDPS** | **`RDPS_10km_PlanetaryBoundaryLayerHeight`** or `RDPS.ETA_HPBL` |
| GDPS  | `GDPS_15km_PlanetaryBoundaryLayerHeight` or `GDPS.ETA_HPBL` |
| CAPS  | `CAPS_3km_PlanetaryBoundaryLayerHeight` |

For RDPS use **`RDPS_10km_PlanetaryBoundaryLayerHeight`** (WCS-style, matches 10 km grid) or **`RDPS.ETA_HPBL`**. Fetch at base or summit; if PBL height &lt; 2630 m, treat air above PBL as stable and use a smaller lapse or allow inversion.

---

## 6. Lake Louise Checklist

| Term           | Source                    | Layer / Coverage              |
|----------------|---------------------------|-------------------------------|
| Short (0–48 h) | HRDPS 2.5 km             | `HRDPS.CONTINENTAL_TT` or WCS `HRDPS-WEonG_2.5km_AirTemp` |
| Medium (48–84 h)| RDPS 10 km              | `RDPS.CONTINENTAL_TT`         |
| Long (3–10 d)  | GDPS 25 km               | `GDPS.CONTINENTAL_TT` or WCS `GDPS_15km_AirTemp_2m` |
| Snowfall       | HRDPS                    | `HRDPS.CONTINENTAL_APCP`; use TMP for rain vs snow. |
| Snow depth     | RDPS                     | `RDPS.CONTINENTAL_ASPC` (or SNDP per docs). |

---

## 7. Relation to This Repo

- **Enable Canadian models:** `GEOMET_ENABLED=1` (handler or dry-run). See `MODEL_AVAILABILITY.md`.
- **EDR:** Not used (api.weather.gc.ca collections returned 404). WMS/WCS in `geometClient.ts` is the data path.
- **Current data path:** WMS GetFeatureInfo (WCS-style layer names) then WCS + netCDF in `geometClient.ts`; HRDPS, RDPS (`RDPS.ETA_TT`), and GDPS filled; RDPS lapse from 2071 m.
- **Request only available leads:** `geometClient.getCapabilities(layerName)` fetches WMS GetCapabilities (with optional `layer=` to limit XML) and parses the time dimension; `geometForecast` uses it to request only lead hours that GeoMet actually provides (avoids 0h/3h right after run).
- **Hash check (like resort XML):** After fetching GeoMet forecast, the handler hashes the payload and compares to `FRONTEND_META` / `GEOMET_HASH`. If unchanged, it reuses the last snapshot’s forecast for render and snapshot; S3/CloudFront update is skipped when the rendered HTML is unchanged (INDEX_HASH).

---

## 8. Rockies Variables and GeoMet Layers (Reference)

For the physics and rationale, see [MODELS_ROCKIES_OPERATIONS.md](MODELS_ROCKIES_OPERATIONS.md) (Part 1–3). Below maps **desired** GRIB2/GeoMet variables to layer names and implementation status.

### Precipitation & snow

| Variable / Use | GRIB2 / Quantity | GeoMet layer (WCS-style or WMS) | Status |
|----------------|------------------|---------------------------------|--------|
| Total precip (mm liquid) | APCP | `HRDPS-WEonG_2.5km_TotalPrecipitation` (then fallback `HRDPS.CONTINENTAL_APCP`), `RDPS.ETA_PR`, `GDPS_15km_TotalPrecipitation` | **In use** — RDPS and GDPS precip; HRDPS precip layers often return XML error from GeoMet WMS (run `npm run check-geomet-precip` to verify). |
| Precip type (rain vs snow) | PRTY | TBD (discover via GetCapabilities) | Roadmap |
| Snow depth | SNOD | TBD | Roadmap |
| Snowfall amount | ASNOW | TBD | Roadmap |

### Steering flow (850–700 hPa)

| Variable | Level | GeoMet layer | Status |
|----------|-------|--------------|--------|
| Vertical velocity (VVEL) | 700 hPa | TBD (WCS/WMS may expose pressure-level layers) | Roadmap — key for powder signal |
| Wind speed/direction (WIND) | 850 hPa | TBD | Roadmap |

### Temperature & stability

| Variable | Use | Status |
|----------|-----|--------|
| TMP surface vs 850 hPa | Inversion detection (850 &gt; surface ⇒ inversion) | HRDPS 2 m in use; 850 hPa TMP not yet |
| Dew point depression (DEPR) | Champagne vs Sierra cement (high DEPR = dry = light snow) | Roadmap |

### Pressure & Chinook

| Variable | Use | Status |
|----------|-----|--------|
| PRMSL | Penticton (CYYF) vs Calgary (CYYC) delta ⇒ Chinook | Roadmap (point requests at two locations or pressure layer) |

### Model selection (from MODELS_ROCKIES_OPERATIONS)

| Feature | HRDPS variable | RDPS variable | Status |
|---------|----------------|---------------|--------|
| Wind holds | WIND_MAX_10m (or GeoMet equivalent) | N/A | Wind from WeatherLink; GeoMet wind gust layer TBD |
| Powder totals | APCP | APCP | **In use** (TotalPrecipitation / ETA_PR) |
| Cloud ceiling | HGT_0.5_shadow | CLOUD_COVER | Roadmap |
| Freezing level | HPGL_0_ISOT (0°C isotherm height, m) | HPGL_0_ISOT | Roadmap |

### Pressure levels for requests

- **Surface:** 10 m (wind), 1.5 m / 2 m (temp) — we use 2 m AirTemp layers.
- **Ridge / free air:** 850 hPa (Norquay/Nakiska), 700 hPa (Sunshine / Lake Louise summit ≈2,700 m). Discover pressure-level layers via GetCapabilities.

### Powder logic to implement

`If (Wind_Direction is SW) AND (VVEL at 700 hPa > 0) AND (Temp_850hPa < −5°C) ⇒ High probability of high-quality powder.` Requires VVEL and 850 hPa temp (and wind direction from model or WeatherLink).

---

## References

- GeoMet: <https://geo.weather.gc.ca/geomet/>
- MSC GeoMet / OGC API: <https://api.weather.gc.ca/> (collections, EDR when available).
- WCS 2.0.1: GetCoverage with SUBSET=Long/Lat, FORMAT=image/netcdf.
- WMS 1.3.0: GetFeatureInfo with LAYERS, BBOX, I, J, INFO_FORMAT=application/json.
