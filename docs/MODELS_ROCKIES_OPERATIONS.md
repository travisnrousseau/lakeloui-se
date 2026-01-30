# Model Selection for Canadian Rockies Ski Operations

This doc explains **why** we use HRDPS, RDPS, and GDPS for Lake Louise and how to interpret them. When pulling data from **MSC GeoMet** (Environment and Climate Change Canada’s API) for the Canadian Rockies, you are translating raw mathematical grids into mountain-specific behaviour. For layer names and API details, see [GEOMET_STRATEGY.md](GEOMET_STRATEGY.md). For inversion, Chinook, orographic lift, and freezing-level **logic**, see [CONTENT_LOGIC.md](CONTENT_LOGIC.md).

---

## Part 1: Rockies Weather Physics (Detail)

#### 1. Orographic Enhancement & Rain Shadows

As moisture-laden air from the Pacific hits the Columbia Mountains and then the Rockies, it is forced upward (**orographic lift**). The air cools adiabatically, condenses, and dumps snow on the windward side.

- **The physics:** The rate of cooling for rising *moist* air is roughly **6.5°C per 1,000 m** (moist adiabatic lapse rate).
- **Rockies nuance:** The Rockies often sit in the **rain shadow** of the Selkirks/Purcells. If the wind is too westerly, moisture is "wrung out" before it hits Banff. You need a **south-westerly** flow for maximum snow in the Central Rockies.

#### 2. The Chinook (Foehn Winds)

A Chinook occurs when moist air drops its moisture on the west side of the Divide and then descends the eastern slopes.

- **The physics:** As the air descends, it warms at the **dry adiabatic lapse rate** (**10°C per 1,000 m**), which is faster than it cooled. This creates rapid warming and extreme evaporation (sublimation) of snow.
- **Rockies nuance:** A Chinook can swing temperatures from −20°C to +10°C in an hour, creating **melt–freeze crusts** that ruin ski conditions.

#### 3. Arctic Outbreaks and Cold Air Pooling

Heavy, dense Arctic air from the Yukon/NWT flows south. Because it is dense, it behaves like a fluid, "sloshing" against the eastern face of the Rockies.

- **The physics:** This cold air often cannot crest the high peaks of the Continental Divide, leading to a shallow cold layer in the valleys while the peaks remain relatively warm.
- **Rockies nuance:** This creates a **temperature inversion**. The resort base might be −30°C while the summit is −10°C.

#### 4. Valley Channeling (The Venturi Effect)

Wind does not move *over* the Rockies; it moves *through* them. Narrow valleys like the Bow Valley act as nozzles.

- **The physics:** As a fluid’s (air’s) passage narrows, its velocity increases.
- **Rockies nuance:** A 20 km/h regional wind can become a 70 km/h gale at a resort mid-mountain if the valley orientation aligns with the pressure gradient.

---

## Why This Matters (Summary)

When looking at weather models for a ski resort in the Canadian Rockies, you are dealing with some of the most complex terrain in the world. Standard global models often **"smooth out"** the mountains, treating a jagged peak and a deep valley as a single flat plateau.

To get an accurate forecast, you have to look at the **HRDPS** (High-Resolution Deterministic Prediction System) and the **GDPS/RDPS** (Global and Regional systems). Here are the most important things to consider and why they matter for mountain operations.

---

## 1. Model Resolution and Orographic Lift

The Canadian Rockies are defined by **orographic lift**—where air is forced upward by the mountains, cools, and dumps snow.

| Model | Resolution | Role |
|-------|------------|------|
| **HRDPS (2.5 km)** | Gold standard for short-term mountain forecasting | Grid points are only 2.5 km apart; the model can "see" individual mountain ranges. It accurately predicts how much extra snow a specific resort will get based on the wind hitting a specific face. |
| **GDPS (≈15–25 km)** | Long-range pattern recognition | Sees the Rockies as a blurry bump. Often **under-predicts** snowfall totals because it doesn't account for localized lifting of air over specific ridges. |

**Why it matters:** If you rely on a low-resolution model alone, you might miss a "stealth" 20 cm dump caused by local terrain enhancement. Use **HRDPS for snowfall totals**; use GDPS for storm *cycles* and large-scale setup, not for specific centimetre counts until HRDPS picks them up.

---

## 2. Wind Channelling and Ridge-Top Speeds

Wind is the enemy of ski resorts: lift closures and **wind slabs** (a primary cause of avalanches).

- **The HRDPS advantage:** In the Rockies, wind doesn't just blow in one direction; it flows through valleys like water. HRDPS is high-resolution enough to simulate **valley channelling**. It can predict if wind will be accelerated through a mountain pass, hitting a specific chairlift.
- **Why it matters:** For Lake Louise (or Sunshine Village), knowing the difference between a 30 km/h wind and a 70 km/h gust at the ridge-top is the difference between a normal day and a total **wind-hold** closure of the upper mountain.

**Use HRDPS for wind gusts and ridge-top speeds;** low-resolution models miss channelling.

---

## 3. Temperature Inversions

The Canadian Rockies are famous for **Arctic outbreaks** and temperature inversions, where the valley floor is significantly colder than the mid-mountain.

- **Vertical profiles:** You need to check the **vertical temperature profile**. HRDPS is much better at capturing the **boundary layer**—the thin slice of air closest to the ground. It can predict when a layer of cold, heavy Arctic air is "sloshing" against the eastern slopes.
- **Guest experience:** Tell skiers it is −25°C at the base but a balmy −10°C at the summit.
- **Operations:** Snowmaking teams need to know if the wet-bulb temperature is low enough to blow snow at the bottom even if the top is warming up.

See CONTENT_LOGIC §II (Temperature Inversions) and GEOMET_STRATEGY §5.4–5.5 (PBL, inversions, HRDPS two-cell vs RDPS/GDPS lapse).

---

## 4. The Chinook Signature

The **Chinook** is a warm, dry wind that can raise temperatures by 20°C in hours, potentially ruining a snowpack.

- **Identifying the setup:** Use **GDPS (Global)** to see the long-range setup of a Chinook (e.g. a massive low-pressure system hitting the BC coast) and **HRDPS** to see exactly when that warm air will "crest" the Continental Divide.
- **Why it matters:** Chinooks often bring high winds and **rain-on-snow** events. Resorts need to know exactly when the freezing level will spike so they can prepare for grooming challenges or potential closures to protect the runs.

See CONTENT_LOGIC §III (Chinook Winds).

---

## 5. Resolution vs. Forecast Horizon

You must balance the **precision** of the HRDPS with the **range** of the GDPS.

| Model | Horizon | Use for |
|-------|---------|---------|
| **HRDPS** | Short range (~48 h) | Tomorrow's powder count, wind-hold risks, freezing level, orographic snow, ridge winds. **Trust the numbers.** |
| **RDPS** | Medium (e.g. 48–84 h) | Best balance of speed and regional accuracy; **timing of fronts** and moisture plumes. |
| **GDPS** | Long (6–10 days) | Large-scale patterns (Arctic outbreaks, storm cycles). **Do not trust specific snowfall "centimetre" counts** until HRDPS picks them up. |

---

## Summary: Which Model for Which Metric

| Metric | Best Model | Why? |
|--------|------------|------|
| **Snowfall totals** | HRDPS | Captures terrain-induced snow (orographic lift). |
| **Wind gusts** | HRDPS | Accounts for valley channelling and ridge acceleration. |
| **Timing of fronts** | RDPS | Best balance of speed and regional accuracy. |
| **Long-term trends** | GDPS | Identifies large-scale patterns (Arctic outbreaks, Chinook setup). |
| **Freezing level** | HRDPS | Essential for rain vs snow at base and for Chinook/rain-on-snow. |

---

## Pro Tip: Freezing Level Over Surface Temp

In the Canadian Rockies, always check the **freezing level** (altitude where temp = 0°C) rather than just the "surface temperature." Because the terrain is so high, the temperature at the base of the mountain is rarely the same as the temperature where the snow is actually forming. Base ≈1,650 m, Summit ≈2,630 m—if the freezing level is at 2,000 m, base gets rain, mid-mountain mixed, summit snow. See CONTENT_LOGIC §V (Freezing Level) and GEOMET_STRATEGY §5 (base vs summit, lapse, vertical profile).

---

## Part 2: Critical Data Points (GeoMet / GRIB2 Variables)

When querying the GeoMet API (via WMS/WCS or OGC API), target these variables. GRIB2 quantity names (e.g. APCP) map to GeoMet layer/coverage IDs—see [GEOMET_STRATEGY.md](GEOMET_STRATEGY.md) and §Part 3 below for layer names.

### 1. Precipitation & Snow Mechanics

| GRIB2 / Quantity | GeoMet / JSON | Use |
|------------------|---------------|-----|
| **Total Precipitation (APCP)** | `Quantity: APCP` or layer equivalent | Liquid-equivalent precip (mm). |
| **Precipitation Type (PRTY)** | PRTY | Vital for the "rain vs snow" line. |
| **Snow Depth (SNOD)** | SNOD | HRDPS modeled snow depth; use cautiously (no skier compaction). |
| **Snowfall Amount (ASNOW)** | ASNOW | Theoretical accumulated snowfall. |

### 2. The "Steering" Flow (850 hPa to 700 hPa)

In the mountains, surface winds are often misleading because of terrain. You must look at the **free-air** flow.

| Variable | Level | Why |
|----------|-------|-----|
| **Vertical Velocity (VVEL)** | 700 hPa | Most underrated. **Positive VVEL** = air forced upward. High VVEL over your coordinates ⇒ expect high-intensity snowfall regardless of the "surface" map. |
| **Wind Speed/Direction (WIND)** | 850 hPa (≈1,500 m) | Shows which way the weather is actually moving, ignoring valley walls. |

### 3. Temperature & Stability

| Variable | Use |
|----------|-----|
| **Temperature (TMP)** at surface vs 850 hPa | If TMP at 850 hPa &gt; surface ⇒ **temperature inversion**. |
| **Dew Point Depression (DEPR)** | (Temp − dew point). **High DEPR** ⇒ dry air ⇒ light/fluffy "Champagne Powder." **Low DEPR (near 0)** ⇒ saturated air ⇒ heavy/wet "Sierra Cement." |

### 4. Pressure & Chinook Prediction

| Variable | Use |
|----------|-----|
| **Sea Level Pressure (PRMSL)** | To predict a Chinook, look at the pressure delta between **Penticton (CYYF)** and **Calgary (CYYC)**. If Pressure(Penticton) ≫ Pressure(Calgary), air is "pushed" over the Divide ⇒ Chinook. |

---

## Part 3: Model Selection Logic for GeoMet

| Feature | HRDPS (2.5 km) Variable | RDPS (10 km) Variable | Why? |
|---------|-------------------------|------------------------|------|
| **Wind holds** | `WIND_MAX_10m` (or GeoMet equivalent) | N/A | HRDPS captures gusts hitting ridge-line chairs. |
| **Powder totals** | `APCP` (e.g. `HRDPS-WEonG_2.5km_TotalPrecipitation`) | `APCP` (e.g. `RDPS.ETA_PR`) | Use HRDPS for 0–48 h; switch to RDPS for 48–84 h. |
| **Cloud ceiling** | `HGT_0.5_shadow` (or GeoMet cloud-base layer) | `CLOUD_COVER` | HRDPS gives better cloud-base heights for visibility. |
| **Freezing level** | `HPGL_0_ISOT` (height of 0°C isotherm, m) | `HPGL_0_ISOT` | Gives altitude (m) of the 0°C isotherm. |

### Technical Tip: Pressure Levels in GeoMet Requests

When using GetFeatureInfo or the OGC API, specify the **pressure level** (or height) in your request where applicable:

- **Surface:** `10 m` for wind, `1.5 m` or 2 m for temp.
- **Ridge-top equivalent:** Request **850 hPa** for resorts like Norquay or Nakiska; **700 hPa** (≈2,700 m) for high-alpine resorts like Sunshine Village / Lake Louise summit.

### Rockies Logic to Code: High-Quality Powder Signal

The most important "Rockies" logic to implement:

**If (Wind_Direction is SW) AND (VVEL at 700 hPa &gt; 0) AND (Temp_850hPa &lt; −5°C) ⇒ High probability of high-quality powder.**

- SW flow brings Pacific moisture into the Central Rockies (avoiding full rain shadow).
- Positive vertical velocity at 700 hPa = lift = precipitation.
- Cold 850 hPa = snow, not rain.

---

## Relation to This Repo

- **Data path:** WMS GetFeatureInfo (WCS-style layer names) then WCS + netCDF in `backend/src/geometClient.ts`; forecast assembly in `backend/src/geometForecast.ts`. HRDPS base + elevation-optimized summit; RDPS lapse from 2071 m; GDPS summit-anchored, base lapse-corrected.
- **Currently pulled:** HRDPS/RDPS/GDPS 2 m temp (AirTemp / ETA_TT), HRDPS/RDPS total precip (APCP equivalent: TotalPrecipitation / ETA_PR), RDPS PBL height (for lapse). Wind at base/summit comes from **WeatherLink** (sensors), not GeoMet.
- **Planned / roadmap:** Vertical profile and freezing level (HPGL_0_ISOT or temp profile); VVEL at 700 hPa; PRTY (precip type); DEPR (dew point depression); PRMSL (Penticton vs Calgary for Chinook); HRDPS wind gust / WIND_MAX_10m for wind-hold; cloud base (HGT_0.5_shadow); powder logic (SW + VVEL_700 &gt; 0 + T_850 &lt; −5°C). See GEOMET_STRATEGY §8 (Rockies variables and GeoMet layers).
