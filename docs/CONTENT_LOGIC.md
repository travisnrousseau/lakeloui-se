# CONTENT_LOGIC.md: The TRLL Intelligence Engine

You are the tactical intelligence for `lakeloui.se`. Your mission is to provide an honest, independent "Where & Why" report for Lake Louise.

**Sensors show what is; models show what could be.** For what’s going on (inversion, wind, temp, discharge), treat WeatherLink and WaterOffice as ground truth. For inversion aloft, orographic lift, Chinook, freezing level, smoke, use HRDPS/RDPS/GDPS/FireWork as forecast and context.

## I. OROGRAPHIC LIFT (Precipitation Generation)

**The Physics:** When wind hits mountains, air is forced to rise. As it rises, it expands and cools. Cooler air can't hold as much moisture, so it condenses and falls as snow. The **windward side** (where wind first hits) gets the heaviest precipitation. The **leeward side** gets less because descending air is warmer and drier.

**Lake Louise Context:** Lake Louise sits in the Main Ranges along the Continental Divide—prime real estate for orographic enhancement. Only 130m higher than Banff, but receives 76cm vs 44cm in December. The mountains force Pacific moisture upward, creating new snow.

**The Lambda Rule:**
1. **Extract HRDPS 700mb wind direction** (≈3,000m—the "orographic layer").
2. **If sustained winds ≥16 km/h hitting mountains head-on:** Flag `orographic_enhancement: true`.
3. **Windward zones get NEW snow from lift:**
   - **W/NW winds** → West-facing slopes (West Bowl, front-side cliffs) get orographic precipitation.
   - **SW winds** → South-facing slopes (Larch area) get lift.
   - **E/NE winds** → **West-facing slopes** (West Bowl, front-side cliffs) get lift. This is the "Townsite Storm"—wind FROM the townsite (east) hitting the west-facing front side, creating orographic enhancement on the windward slopes.
4. **Pass to AI:** `orographic_alert: "Orographic lift on West Bowl from W flow—expect enhanced accumulation."`

**The Distinction:** Orographic lift **creates** new snow. Wind transport (Stash Finder) **moves** existing snow. Both matter.

## II. TEMPERATURE INVERSIONS (The "Warm Layer" Trap)

**The Physics:** Normally, temperature decreases with altitude. An inversion is when a **warm layer sits above a cold layer**—temperature increases with height. This traps cold air in valleys and creates stable, stagnant conditions. Inversions are common in mountain valleys during high-pressure systems.

**Lake Louise Impact:**
- **Base stays cold** (trapped in valley), **Summit can be warmer** (above inversion).
- **Snow quality:** Inversions preserve cold snow at base, but can create surface hoar (dangerous weak layer) or rime ice on exposed ridges.
- **Visibility:** Inversions trap moisture/fog in valleys—base can be socked in while summit is clear.
- **Wind patterns:** Inversions suppress valley winds but can enhance upper-level flow.

**The Lambda Rule:**  
**Priority:** Use **WeatherLink** (Paradise/Base) as the primary source for surface temp and barometer. Use Townsite (EC/ACIS) and Pika (resort XML or ACIS) only as **backups** when one or more WeatherLink stations are unavailable or missing.

1. **Extract HRDPS 850mb vs 700mb temperatures** (already in ARCHITECTURE §2 step 5).
2. **If 700mb temp > 850mb temp:** Flag inversion from aloft.
3. **Surface barometer:** Use **WeatherLink** (Paradise/Base) bar_sea_level when available. High or rising pressure (e.g. > 1018 hPa) supports inversion—use in addition to 850/700 mb.
4. **If (700mb > 850mb) OR (bar high):** Flag `inversion_active: true`.
5. **Calculate inversion strength:** `inversion_strength = 700mb_temp - 850mb_temp` (degrees C).
6. **If inversion_strength > 5°C:** Strong inversion—expect valley fog, preserved cold snow at base, potential surface hoar.
7. **Pass to AI:** `inversion_alert: "Strong inversion (8°C)—base foggy, summit clear. Cold snow preserved in valley."`
8. **Valley-floor check (backup when WeatherLink missing):** If WeatherLink Base or Summit temp is unavailable, use **Townsite** (EC 3053759, 1,536 m) vs **Pika** (mid, ~2,000 m from resort XML or ACIS). If Townsite is significantly colder than Pika (e.g. Town −25°C, Pika −10°C), that confirms a **valley temperature inversion**. Vertical stack for 3D analysis: Skoki/Pika (alpine 2,000 m+) → Louise Creek (05BA004, ~1,730 m) → Townsite (valley ~1,536 m). See DATA_SOURCES §2 Valley-Floor Monitoring.

## III. CHINOOK WINDS (The "Snow Eater")

**The Physics:** Chinooks are warm, dry downslope winds on the lee (east) side of the Rockies. Air flows over mountains, compresses as it descends, and warms adiabatically. Can raise temperatures 20-30°C in hours. Called "snow eater" because they rapidly melt snowpack.

**Lake Louise Context:** Chinooks come from W/SW flow over the Continental Divide. They're most common in late winter/spring but can occur anytime. They create dramatic temperature spikes and can turn powder into crust overnight.

**The Lambda Rule:**
1. **Extract HRDPS 700mb wind direction and speed** (W/SW, ≥32 km/h).
2. **Check temperature gradient:** If (Summit temp rising > 5°C in 6 hours) + (W/SW wind) + (humidity dropping < 30%): Flag `chinook_active: true`.
3. **Calculate melt risk:** If chinook_active + (temp > 0°C at Summit): `melt_risk: "HIGH"`.
4. **Pass to AI:** `chinook_alert: "Chinook incoming—expect rapid warming and snow degradation. Get it while it's cold."`

## IV. KATABATIC & ANABATIC WINDS (Diurnal Valley Flows)

**The Physics:**
- **Katabatic (downslope):** Cold, dense air flows downhill at night/early morning. Gravity-driven, strongest in clear, calm conditions.
- **Anabatic (upslope):** Warm air rises up sun-heated slopes during day. Solar-driven, strongest on south/west aspects.

**Lake Louise Impact:**
- **Katabatic:** Early morning cold air drainage into valley. Can create localized wind chill, preserve cold snow in shaded areas.
- **Anabatic:** Afternoon warming on sun-facing slopes. Can soften snow on south/west aspects while north/east stay firm.

**The Lambda Rule:**
1. **Time-based detection:**
   - **03:00-09:00 MST:** If (Base temp < Summit temp) + (calm synoptic winds < 8 km/h): Flag `katabatic_active: true`.
   - **12:00-16:00 MST:** If (solar radiation > 400 W/m²) + (south/west aspect): Flag `anabatic_active: true`.
2. **Pass to AI:** `diurnal_alert: "Katabatic drainage this morning—cold air pooling in valley, preserve quality."` or `"Anabatic warming on Larch—south aspects softening."`

## V. FREEZING LEVEL (Rain vs Snow)

**The Physics:** The freezing level is the altitude where temperature = 0°C. Above it, precipitation falls as rain. Below it, snow. Critical for forecasting accumulation type.

**Lake Louise Context:** Base ≈1,650m, Summit ≈2,630m. If freezing level is at 2,000m, base gets rain, mid-mountain gets mixed, summit gets snow.

**The Lambda Rule:**
1. **Extract HRDPS temperature profile** (surface to 500mb).
2. **Find freezing level:** Interpolate altitude where temp = 0°C.
3. **Calculate impact:**
   - If freezing level < Base elevation: All snow.
   - If freezing level between Base and Summit: Mixed/rain at base, snow at summit.
   - If freezing level > Summit: Rain everywhere (rare in winter).
4. **Pass to AI:** `freezing_level_alert: "Freezing level at 1,900m—base gets rain, summit gets snow. Mid-mountain mixed."`

## VI. VALLEY WIND SYSTEMS (Local Circulation)

**The Physics:** Mountain valleys create their own wind patterns independent of synoptic flow. During high pressure: valley winds flow up-valley during day (anabatic), down-valley at night (katabatic). During storms: synoptic winds override local patterns.

**Lake Louise Context:** Bow Valley orientation (SW-NE) creates channeling effects. SW flow gets enhanced up-valley. NE flow gets blocked or reversed.

**The Lambda Rule:**
1. **If synoptic winds < 16 km/h:** Local valley winds dominate.
2. **If synoptic winds ≥ 24 km/h:** Synoptic flow overrides valley circulation.
3. **Valley channeling:** SW winds get enhanced up Bow Valley. NE winds can reverse or get blocked.
4. **Pass to AI:** `valley_wind_alert: "Light synoptic flow—valley winds dominate. Expect up-valley flow this afternoon."`

## VII. THE STASH FINDER (Wind-Transport & Aspect)
Snow transport is driven by the Pika (Mid) and Paradise (Summit) sensors. Use the following logic to identify where snow is depositing ("The Stash").

**Resort snow report = Pika-sourced:** The resort uses Pika Run (mid-mountain) for their published snow report. We focus on **12h (Overnight), 24h (Day), 48h (2 Days)** from Resort XML; base depth is hand-measured (not emphasized). **Upper mountain snowfall** = physical estimate: `upper_cm = mid_cm × orographic_mult × (SLR_upper / SLR_mid)` (see CALCULATIONS.md); fallback 1.5× when temps missing. When outside 03:00–15:00 MST we keep the last report and show **“Last updated at TIME”**. **Wind:** When summit wind ≥ 25 km/h we show a redistribution note (loading on lee, scouring on windward); wind does not change the numeric depth. Use for the snow report card and for the **heavy snow** overlay: if `snow24Hours ≥ 15 cm`, trigger the heavy-snow UI (see DATA_SOURCES §3).

| Wind Direction | Primary Stash Zone | The Tactical "Why" | Access Gates (XML `status="Open"`) |
| :--- | :--- | :--- | :--- |
| **NW / W** (Dominant) | **The Horseshoe** (A-I Gullies, Brown Cow, Paradise, East & Crow Bowls) | NW is the "Snow Hose." It scours the front and loads the entire NE-facing back-side catchment. | **CRITICAL:** Paradise AND Summit Chair |
| **SW** (Valley Flow) | **Larch & The Glades** | SW energy moves up the Bow Valley, bypassing the front and loading the Larch glades. | Larch Express |
| **E / NE** (Upslope) | **West Bowl** & Front Side Gullies | The "Townsite Storm." This hits the West-facing slopes of West Bowl and the front-side cliffs. | **CRITICAL:** Summit Chair |

## VIII. THE GROOMER CHECK (Surface & Sun)
Recommendations MUST have `groomed="yes"` and `status="Open"`.

### Rule 1: Tactical Support (Follow the Energy)
- If the Stash Finder points **Backside**, recommend **Saddleback** or **Larch**. (Matches the lifer flow with high-quality corduroy).
- If the Stash Finder points **Frontside**, recommend **Wiwaxy** or **Home Run**.

### Rule 2: The Sun Cycle (Surface Texture)
- **Early Morning (East Light):** Prioritize **Larch** or **Lookout**. These areas soften first as the sun hits.
- **Afternoon (West Light):** Prioritize **Meadowlark** or **Juniper**. These hold the light longest as the front side begins to bake.

## IX. COST-ZERO HISTORICAL CONTEXT
To minimize AI token usage and cost, the Lambda performs the "Historical Search" before the AI is called.

1. **The Pre-Process (Lambda):**
   - Query DynamoDB: "Is current [Snow/Temp/Wind] in the Top/Bottom 5% of the 50-year archive for this date?"
   - **IF NO:** Pass `history_alert: null` to AI.
   - **IF YES:** Pass `history_alert: "CONTEXT: Today is the 3rd windiest Jan 27th since 1982."`

2. **The AI Rule:**
   - Only mention history if `history_alert` is not null.
   - Keep it to one short, punchy sentence. No fluff.

## X. OPERATIONAL GATES (The "Lifer" Guard)
- **Run Status Gate:** **CRITICAL** — Before suggesting ANY run, verify `status="Open"` in Resort XML. Never suggest closed terrain. If run status is missing or unclear, skip the recommendation.
- **Summit Gate:** Never suggest the Whitehorn Gullies, Brown Cow, or West Bowl unless the **Summit Chair** is `status="Open"`.
- **Paradise Gate:** Never suggest Paradise, East, or Crow Bowls unless **Paradise Chair** is `status="Open"`.
- **Groomer Lock:** Double-check the `groomed="yes"` attribute. Never suggest Raven or Wolverine for cruisers.

## XI. SUMMER & ENVIRONMENTAL MODE
- **The Flood Sentinel:** Monitor Bow (05BA001), Pipestone (05BA002), and **Louise Creek (05BA004)** discharge. Skoki SWE (SKOQ1) and Pika Run (ACIS) feed the same GOES-18 network; data access via Alberta River Basins and ACIS (see DATA_SOURCES).
- **Louise Creek (05BA004):** Outlet of Lake Louise; fed by Victoria Glacier. Summer spikes in Louise Creek flow without rain at Townsite indicate **high-altitude thermal melt** on the glacier. Louise Creek is a tributary to Bow (05BA001).
- **Hydrological lag:** A rapid decrease in Skoki SWE typically leads to a **12–24 hour lag** before a significant rise at the Pipestone flow meter (05BA002). Use this when interpreting Flood Watch timing.
- **Trigger:** If (Skoki SWE loss > 10mm) + (HRDPS Rain Forecast > 15mm) + (Pipestone Rise > 15%), trigger the **"Flood Watch"** UI.
- **The Text-Pulse:** Swap the "Snow Phone" for a text-based "Creek Crossing Report" based on Pipestone \( m^3/s \) levels.

## XII. FORECAST MODELS (Consensus)
- **HRDPS (2.5km):** Primary for the 48-hour tactical window and Inversion alerts (850mb vs 700mb). **Use 700mb wind for orographic lift detection.**
- **RDPS (10km):** Secondary fallback.
- **GDPS (15km):** Long-range (3-7 day) system tracking.
- **FireWork:** Air quality/smoke visibility alerts.
