# Data Sources & Access (lakeloui.se)

What we pull and what we use.

---

## Principle: Sensors vs Models

- **Sensors show what is** — WeatherLink (Paradise/Base), WaterOffice (Bow 05BA001, Pipestone 05BA002, Louise Creek 05BA004); Pika and Skoki from ACIS & Alberta River Basins (see §2). Live ground truth: temp, wind, barometer, inversion support, discharge.
- **Priority:** Use **WeatherLink** as the primary source for temp, wind, and barometer. Pika (resort XML or ACIS) for snow report. **Townsite (EC 3053759)** is left in code but **does not currently work and is not planned**; do **not** use or use as fallback (see §2 Valley-Floor).
- **Models show what could be** — HRDPS, RDPS, GDPS, FireWork. Forecast and context: inversion aloft (850 vs 700 mb), orographic lift, Chinook, freezing level, smoke. Use sensors for “what’s happening now”; use models for “what to expect” and to support alerts (e.g. inversion from aloft + bar from sensors).

---

## 1. WeatherLink API v2 (Sensors — what is — “Truth” sensors)

**Polling:** Every **5 minutes** (Pro account allowance).

**Endpoint:** `GET https://api.weatherlink.com/v2/current/{station_id}`  
**Auth:** `api-key` (query), `X-Api-Secret` (header).

**Stations:** Paradise Top (summit) and Base (Operations). Set `WEATHERLINK_STATION_ID` (Paradise) and `WEATHERLINK_STATION_ID_BASE` (Base) in env; both optional. Order in UI: index 0 = Summit (Paradise), index 1 = Base.

### Response shape (summary)

- **Top level:** `station_id`, `station_name`, `ts` (Unix), `sensors` (array).
- **Per sensor:** `lsid`, `sensor_type`, `data_structure_type`, `data` (array of records).
- **ISS current (data_structure_type 10)** — typical for WeatherLink Live / Vantage Pro:
  - **temp** — outside temp (°C or °F by station config)
  - **hum** — relative humidity (%)
  - **dew_point**, **wet_bulb**, **heat_index**, **wind_chill**, **thw_index**
  - **wind_speed_last** — last wind speed (m/s, mph, or km/h)
  - **wind_dir_last** — last wind direction (degrees)
  - **wind_speed_avg_last_1_min**, **wind_speed_avg_last_10_min**, **wind_speed_hi_last_10_min**, **wind_dir_at_hi_speed_last_10_min**
  - **rain_rate_last**, **rainfall_last_15_min**, **rainfall_last_24_hr**, **rain_storm_***
  - **solar_rad**, **uv_index**
  - **bar_absolute**, **bar_sea_level**, **bar_trend**

Exact fields and units depend on hardware and are described in the [Sensor Catalog](https://weatherlink.github.io/v2-api/sensor-catalog) and [Data structure types](https://weatherlink.github.io/v2-api/data-structure-types).

### What we use today

- **temp** — Summit (Paradise) temp on the HUD.
- **wind_speed_last** (or equivalent) — wind speed for display.
- **wind_dir_last** (or equivalent) — wind direction for display and Stash Finder.
- **wind_chill** / **heat_index** — Feels like shown subtly when >2°C different from temp.
- **bar_sea_level** (or **bar_absolute**) — Inversion support: bar > 1018 hPa used in addition to HRDPS 850 vs 700 mb (assumes hPa; if inHg, ~30 inHg).

### What we could use next

- **hum**, **dew_point** — frost risk and humidity; “feels like” and frost risk.
- **wind_speed_avg_last_10_min**, **wind_speed_hi_last_10_min** — for gusts and sparklines.
- **rain_rate_last**, **rainfall_last_*** — for precip and “heavy snow” overlay.
- **bar_trend** — rising/falling pressure for inversion and system changes.
- **solar_rad** — for anabatic/katabatic and time-of-day logic.

---

## 2. WaterOffice (Environment Canada / GOES) — Sensors, what is

**Stations (hydrometric):** Bow River at Lake Louise (05BA001), Pipestone River near Lake Louise (05BA002), **Louise Creek near Lake Louise (05BA004)** — outlet of Lake Louise, Victoria Glacier discharge. Pika Run and Skoki Snow Pillow are on **ACIS & Alberta River Basins** (GOES-18 DCP), not WaterOffice; see "High-Alpine Monitoring" below.

**Method:** Real-time Datamart CSV over HTTP. Web service: `stations[]`, `parameters[]`, `start_date`, `end_date`. Times in UTC.

### Information we can get (per station)

| Parameter code | Description        | Units (typical) | Notes                    |
|----------------|--------------------|------------------|--------------------------|
| **46**         | Water level        | m                | Unit values (instant)    |
| **47**         | Discharge          | m³/s             | Unit values (instant)    |
| **3**          | Water level (daily)| m                | Daily mean               |
| **6**          | Discharge (daily)  | m³/s             | Daily mean               |

Real-time “recent” endpoint returns the latest available unit values (46, 47). No air/water temperature in the standard hydrometric parameters; some stations have additional sensors (check station metadata).

### How often to pull

- **GOES/telemetry:** Stations typically report every **1–6 hours** (data “normally posted within six hours”; “last 2 hours” is used as a freshness indicator). So the *source* doesn’t update every minute.
- **Our side:** Pulling every **5 minutes** (with the Lambda) is fine: we get whatever is latest; more frequent pulls don’t add new data. Keeps Flood Sentinel and Creek Crossing in step with the rest of the pipeline without over-calling the service.

### High-Alpine Monitoring: Skoki Snow Pillow & Pika Run Weather Station

**Network:** Alberta Climate Information Service (ACIS) & Alberta River Basins  
**Protocol:** GOES (Geostationary Operational Environmental Satellite) Data Collection System (DCS)  
**Primary satellite:** GOES-18 (GOES-West)  
**Data relay:** DCP (Data Collection Platform) hourly burst transmissions  
**Region:** Lake Louise / Banff National Park, Alberta, Canada

WaterOffice (above) is hydrometric (rivers) only. We only fetch **05BA001** (Bow at Lake Louise) and **05BA002** (Pipestone) in code. Skoki and Pika are on **ACIS & Alberta River Basins**, same GOES family but different catalogue and access.

---

#### Station 1: Skoki Snow Pillow

| Field | Value |
|-------|--------|
| **Station ID** | SKOQ1 / SKOKI |
| **Location** | Red Deer River Headwaters, Skoki Valley |
| **Elevation** | 2,040 m (6,693 ft) |
| **Purpose** | Hydrological forecasting and water resource management |

**Sensors:** Snow Water Equivalent (SWE) via snow pillow, mm; ultrasonic snow depth; ambient air temperature (shielded thermistor).

**Use:** Winter — snow loading on deep layers, water storage for Red Deer basin. Summer — freshet (melt) forecasting; rapid SWE drop = high runoff, early flood signal for downstream.

---

#### Station 2: Pika Run Weather Station

| Field | Value |
|-------|--------|
| **Station ID** | Pika Run (ACIS) |
| **Location** | Mid-mountain, Lake Louise Ski Resort (front side) |
| **Elevation** | ~2,000 m (6,561 ft) |
| **Purpose** | Meteorological safety, resort operations, avalanche forecasting |

**Sensors:** Dual heated anemometers (wind speed/direction, wind loading); all-season weighing precipitation gauge (storm SWE); relative humidity & temperature (wet-bulb for snowmaking).

**Use:** Winter — primary input for Lake Louise Snow Safety; wind-direction shifts and lee-side deposition (avalanche hazard). Summer — micro-climate and American Pika (alpine climate indicator).

---

#### Satellite link and data gaps

Both stations are in **topographic shadow** (no terrestrial radio/cellular). If the pipeline or AI sees a gap, consider **GOES satellite interference or solar flare** before assuming sensor failure. Data is usually summarized every **15–60 minutes** and sent in bursts.

#### Skoki–Pika gradient (synoptic context)

Discrepancies between the two stations indicate local mountain effects: e.g. high winds at Pika with stable SWE at Skoki → **localized wind transport** (drifting), not region-wide storm; rising temps at Pika with Skoki cold → **valley inversion** (common in Bow Valley).

#### Hydrological link to rivers

For Flood Sentinel and Creek Crossing, link Skoki/Pika to **05BA001 (Bow at Lake Louise)** and **05BA002 (Pipestone)**. **Rule of thumb:** A rapid decrease in Skoki SWE typically leads to a **12–24 hour lag** before a significant rise at the Pipestone flow meter (see CONTENT_LOGIC §XI).

#### Direct data access

| Use | URL |
|-----|-----|
| **Real-time** | [Alberta River Basins (rivers.alberta.ca)](https://rivers.alberta.ca/) |
| **Historical** | [Alberta Climate Information Service (ACIS)](https://acis.alberta.ca/) |
| **Snow safety** | [Avalanche Canada — Mountain Weather Forecast](https://www.avalanche.ca/) |

**Implementation:** Add a dedicated fetcher for ACIS / Alberta River Basins when API or CSV access for SKOQ1 and Pika Run is confirmed; wire Skoki SWE (and optionally Pika wind/precip) into Flood Sentinel and Creek Crossing logic.

---

### Valley-Floor Monitoring: Lake Louise Townsite & Louise Creek

**Network:** Environment Canada (EC), Alberta Climate Information Service (ACIS), Water Survey of Canada (WSC).  
**Region:** Lake Louise Village / Bow Valley bottom.  
**Primary utility:** Inversion detection (valley vs mid), highway/travel safety, glacial lake discharge.

---

#### Station 3: Lake Louise Village (Townsite)

| Field | Value |
|-------|--------|
| **Station ID** | 3053759 (Environment Canada) / Lake Louise ACIS |
| **Location** | Valley floor, adjacent to Trans-Canada Highway / Village interface; **Banff National Park** / **Improvement District No. 9 (ID9)** |
| **Elevation** | 1,536 m (5,039 ft) |
| **Purpose** | Urban/highway meteorology; climate baseline for Bow Valley |

**Sensors:** Ambient air temperature (regional "base" temp), daily precipitation (rain/snow at valley level), barometric pressure (synoptic storm tracking through Kicking Horse Pass).

**Operational significance:** **Inversion metric** — Townsite is the control variable against **Pika**. When Townsite is significantly colder than Pika (e.g. Town −25°C, Pika −10°C), that confirms a **valley temperature inversion** (air quality, heating demand). Unlike remote GOES stations (Skoki/Pika), Townsite is often on terrestrial/cellular; if Skoki goes offline but Townsite stays online, the issue is likely satellite uplink or DCP antenna (e.g. snow-capping).

**Data access:** [Environment Canada — Historical/Real-time](https://weather.gc.ca/); ACIS (Lake Louise).

**Implementation — Townsite left in code only; do not use or use as fallback:** Townsite (3053759) is **not currently available** from MSC GeoMet: SWOB returns 0 for `clim_id=3053759`, and climate-hourly (AB, limit=200) does not include 3053759 (verified Jan 2026). The fetcher `backend/src/townsite.ts` returns null without making a request (saves Lambda cost). The handler still calls it and stores `townsite` in Live_Log for consistency; **Townsite is not used for display or as a fallback** for Summit/Base. Inversion uses WeatherLink (and HRDPS) only. **Status:** Non-functional; **not planned** to be restored. Code is kept for reference only. Do **not** wire Townsite into UI or use as fallback. If EC adds the station in future, the fetch in `townsite.ts` can be re-enabled and this doc updated.

---

#### Station 4: Louise Creek near Lake Louise

| Field | Value |
|-------|--------|
| **Station ID** | 05BA004 (Water Survey of Canada) |
| **Location** | Outlet of Lake Louise (the lake), before it joins the Bow River |
| **Elevation** | ~1,730 m (5,676 ft) |
| **Purpose** | Victoria Glacier and Lake Louise discharge; lake levels |

**Sensors:** Water level (stage), discharge (m³/s).

**Operational significance:** **Glacial health** — Louise Creek is fed almost exclusively by the **Victoria Glacier** (via the lake); summer flow is a direct proxy for glacial melt. **Sediment loading** — high flows carry "rock flour" (glacial silt), contributing to the turquoise colour of the lake and Bow. **Micro-scale hydrology** — unlike Pipestone (large valley system), Louise Creek responds to temperature and melt in the **Fairview/Victoria alpine cirque** specifically.

**Hydrological routing:** Louise Creek (05BA004) is a **tributary to the Bow River (05BA001)**. In summer, a spike in Louise Creek flow without corresponding rain at Townsite indicates **high-altitude thermal melt** on the Victoria Glacier.

**Data access:** [Water Survey of Canada — Real-time Hydrometric (05BA004)](https://wateroffice.ec.gc.ca/report/real_time_e.html?station_number=05BA004).

**Implementation:** 05BA004 is included in our WaterOffice fetcher (see station list in code). Use for glacial-discharge context and vertical-stack analysis.

---

#### Vertical profile ("the stack")

For a 3D view of Lake Louise weather, compare stations by elevation:

1. **Skoki / Pika** — Alpine (2,000 m+).
2. **Louise Creek** — Intermediate / lake level (~1,730 m).
3. **Townsite** — Valley floor (~1,536 m).

*Anomaly:* If Louise Creek is warmer than Townsite in winter, that can indicate a **cold air pool** trapped in the village.

---

## 3. Resort XML (mtnxml.php) — Ops, what is

**Source:** Lake Louise resort.  
**Method:** HTTP GET. **Window:** 03:00–15:00 MST only.  
**Use:** Open/closed, groomed status, run list; MD5 skip when unchanged.

### Resort snow report (Pika-sourced)

The resort uses **Pika Run** (mid-mountain weather station, ACIS) as the source for their published snow report. We focus on **new snowfall periods**, not base depth (base is hand-measured by the resort; we are not concerned with that for the snow card yet).

**Periods we use (resort XML):**

| XML field        | Label on site   | Meaning        |
|------------------|-----------------|----------------|
| **snowOverNight** | 12h (Overnight) | Last 12 hours  |
| **snow24Hours**   | 24h (Day)       | Last 24 hours  |
| **snow48Hours**   | 48h (2 Days)    | Last 48 hours  |

- **base** — Resort hand-measured depth (cm); we do not emphasize it on the snow card.
- **snow7Days**, **snowYearToDate** — Available in XML; we can surface later if needed.
- **temperature**, **weatherConditions**, **primarySurface**, **secondarySurface**, **lastSnowfallDate** / **lastSnowfallUpdate** — Resort-wide; we show conditions and “Last updated at TIME”.

**Upper mountain snowfall (est.):** We use **physical equations** (SLR from temperature + orographic multiplier), not a fixed 1.5×. See **CALCULATIONS.md** for full equations. Summary:

- **Mid (Pika):** 12h, 24h, 48h from resort XML.
- **Upper mountain (est.):** `upper_cm = mid_cm × orographic_mult × (SLR_upper / SLR_mid)` with temps from Pika (XML) and Paradise (WeatherLink). When temps are missing we fall back to 1.5×.

**Calculation (resort side):** Pika’s weighing gauge gives **Storm SWE** (mm). Resort converts to depth (cm) with snow density. Base depth is hand-measured; 12h/24h/48h are tied to Pika’s gauge.

**Persistence when outside resort window:** We keep the last snow report in DynamoDB and show **“Last updated at TIME”** (MST).

**Our implementation:** Pika location from XML by `location.name`; persist to `LAST_SNOW_REPORT`; upper estimate via `snowMath.ts` (SLR + orographic). Heavy snow overlay: `snow24Hours ≥ 15 cm`. **Wind:** When summit wind ≥ 25 km/h we show a redistribution note (e.g. “Strong NW wind — loading on SE aspects, scouring on NW”); wind does not change the single basin-depth number (redistribution only).

---

## 4. MSC models (HRDPS, RDPS, GDPS, FireWork) — What could be

**Method:** GRIB2 byte-range or full-file (when .idx 404).  
**Use:** Inversion aloft (850 vs 700 mb), orographic lift (700 mb wind), Chinook, freezing level, FireWork smoke. Forecast and context; ground truth for “what’s going on” comes from sensors (WeatherLink temp/wind/bar, WaterOffice).

### HRDPS Continental vs HRDPS 1km West

| Product | Domain | Resolution | Runs (UTC) | Forecast | Coverage |
|--------|--------|------------|------------|----------|----------|
| **HRDPS Continental** | Pan-Canada | 2.5 km | 00, 06, 12, 18 | 48 h | Most of Canada |
| **HRDPS 1km West** | West | ~1 km | 00, 12 | 48 h | BC + Western Alberta (includes Lake Louise) |

- **Continental:** `dd.weather.gc.ca` or `dd.meteo.gc.ca` → `model_hrdps/continental/2.5km/{HH}/{hhh}/`. Used for inversion (850/700 mb) and as fallback for forecast.
- **1km West:** `dd.alpha.weather.gc.ca` → `model_hrdps/west/1km/grib2/{HH}/{hhh}/`. Experimental; when run is 00 or 12 we try 1km West first for the forecast (Lake Louise in domain), then Continental. Same file naming (MSC_HRDPS_...) and grid suffix (RLatLon) where applicable.

**Implementation:** `backend/src/mscModels.ts`. Station pins (Base, Paradise, Pika, Skoki) include **elevation (m)** in COORDS; values are extracted at (lat, lon) via **nearest-grid-point** from the GRIB grid definition. We fetch **2 m AGL** at each station for “model at station location”; 850/700 mb for inversion aloft.

---

## 5. Live_Log (DynamoDB)

**Write:** Every 5 minutes — WeatherLink (Paradise), WaterOffice, MSC clip, resort summary.  
**Use:** Pre-render, historical comparison, sparklines (from stored series).
