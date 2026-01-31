# AI Weather Output (wx.lakeloui.se)

Spec for the **forecast people read** at wx.lakeloui.se. The Lambda turns sensors + models into structured alerts; the LLM turns those alerts into a short, human-readable **forecast** (conditions now, what to expect, and—when relevant—a stash note and a groomer pick). This doc defines that output. The main product is the **readable forecast**; Stash Finder and Groomer Check are optional parts of the same report.

**Input to the LLM:** [CONTENT_LOGIC](CONTENT_LOGIC.md) alerts (orographic, inversion, Chinook, freezing level, Stash Finder, Groomer Check, history_alert) + resort summary (open/groomed, snow report).  
**Upstream (what feeds those alerts):** Yes — **weather models** and **sensors**. The Lambda pulls **HRDPS, RDPS, GDPS** (and optionally FireWork) via [GEOMET_STRATEGY](GEOMET_STRATEGY.md) for forecast fields (snow timing, wind direction, freezing level, orographic lift, inversion/Chinook logic) and **WeatherLink** (Paradise/Base), **Pika** (snow report), **WaterOffice** (discharge) for observations. So the AI output is explicitly driven by model + sensor data; see [DATA_SOURCES](DATA_SOURCES.md) and [MODELS_ROCKIES_OPERATIONS](MODELS_ROCKIES_OPERATIONS.md).  
**Which LLM:** [AI_MODELS](AI_MODELS.md).  
**Rockies weather physics (orographic lift, Chinook, inversion, valley channelling, freezing level):** [MODELS_ROCKIES_OPERATIONS](MODELS_ROCKIES_OPERATIONS.md).

---

## 1. Report schedule and audience

We produce **two (or more) reports per day**, at different times and for different audiences.

| Time (MST) | Audience | Purpose |
|------------|----------|--------|
| **04:00** | **Snow Reporters** (Lake Louise Ski Resort) | Technical report. Safe to use more technical terms; **explain each term clearly and explain why it’s happening.** See §1.1. |
| **06:00** | **Public** | Simple, non-technical summary. See §1.2. |
| **After 06:00, before 10:00** | Same as 06:00 (public) | If the resort publishes another snow report after 06:00 (typically around **05:30**), **re-run the public report** as many times as needed, as long as it’s still before 10:00. Each new resort report triggers a fresh narrative so the public copy matches the latest conditions. |

### 1.1 4am report (Snow Reporters — technical)

- **Tone:** Technical but easy to understand. Use terms like *orographic lift*, *inversion*, *Chinook*, *freezing level*, *valley channelling* — and **explain each in one short phrase** so a new Snow Reporter can learn.
- **Length:** 4 to 6 sentences.
- **Must include:**
  - **New snow from Pika station** — latest reading; state the value and time of observation. Pika is the same GOES-18 / Alberta River Basins source as the **"Pika & Skoki (GOES-18)"** card on the dashboard; see [DATA_SOURCES](DATA_SOURCES.md) §2 (High-Alpine Monitoring) and [PROJECT_STATUS](PROJECT_STATUS.md) (Pika/Skoki).
  - **Snow forecast in the next 12 hours** — when (time windows) and approximate amount if available from HRDPS; explain *why* (e.g. orographic lift from W flow, front passage).
  - **Wind direction forecast** — and **where the best skiing will be** given that wind (e.g. “W winds → west-facing lee holds cold snow”; “SW flow → orographic enhancement on West Bowl”).
- **Exceptional physics:** If any of the following are active, **call them out by name and explain briefly** so Reporters (and readers) learn the environment:
  - **Inversion** — cold air trapped in the valley; base colder than summit; valley fog; why it happens (e.g. Arctic air pooling, high pressure). See [MODELS_ROCKIES_OPERATIONS](MODELS_ROCKIES_OPERATIONS.md) §3 and CONTENT_LOGIC §II.
  - **Chinook** — warm, dry downslope wind; rapid warming; “snow eater”; melt–freeze crust risk. See MODELS_ROCKIES_OPERATIONS §4 and CONTENT_LOGIC §III.
  - **Orographic lift** — air forced up by terrain; where snow is enhanced (windward slopes). See MODELS_ROCKIES_OPERATIONS §1 and CONTENT_LOGIC §I.
  - **Valley channelling / Venturi** — wind funnelled through valleys; stronger at ridge-top; wind-hold risk. See MODELS_ROCKIES_OPERATIONS §2.
  - **Freezing level** — altitude where it’s 0°C; rain vs snow at base vs summit. See MODELS_ROCKIES_OPERATIONS “Pro Tip” and CONTENT_LOGIC §V.
  - **Arctic outbreak / cold air pooling** — dense cold air against the Divide; inversion link. See MODELS_ROCKIES_OPERATIONS §3.
- **Goal:** Snow Reporters get a precise, educational brief they can use on the hill and that teaches *why* conditions are the way they are.

**4am report email:** When the 4am MST report runs, the Lambda can send the **full index.html** (same content as the live page, including the AI summary and all cards) to a configured address via AWS SES. Set `REPORT_4AM_EMAIL` (recipient) and `SES_FROM_EMAIL` (verified sender, e.g. WorkMail-hosted `info@rousseau.tv`) in Terraform or Lambda env; if either is empty, no email is sent. See `infrastructure/terraform/terraform.tfvars.example` and variables `report_4am_email` / `ses_from_email`. **Local dry-run:** For `npm run dry-render:4am` to send the email, add `REPORT_4AM_EMAIL` and `SES_FROM_EMAIL` to `backend/.env`; otherwise the script logs "email skipped" and only writes the HTML to `/tmp`.

**Input payload for 4am (so the model can call out scientific happenings accurately):** In addition to the shared payload (summit/base temp and wind, snow_24h_cm, snow_overnight_cm, open_lifts, groomed_runs, inversion_active), the Lambda sends:

| Field | Source | Purpose |
|-------|--------|---------|
| `snow_report_observed_at` | Resort XML `lastSnowfallUpdate` or `lastSnowfallDate` | So the brief can state "Pika at 04:00" (observation time). |
| `forecast_12h_precip_mm` | HRDPS/RDPS — sum of precip (mm liquid) for leads 0–12 h | Next 12 h snow forecast; model states amount and time windows. |
| `forecast_12h_wind_kmh`, `forecast_12h_wind_dir_deg` | HRDPS/RDPS 6 h or 12 h lead | Wind direction forecast and where best skiing will be. |
| `forecast_12h_temp_base_c`, `forecast_12h_temp_summit_c` | HRDPS/RDPS 6 h or 12 h lead | Model temps for next 12 h. |
| `freezing_level_m` | Vertical profile (HRDPS) — level where temp = 0°C | So the brief can state freezing level and rain vs snow at base/summit. |
| `physics_orographic` | Derived: westerly wind + forecast precip > 0 | Model calls out orographic lift by name when true. |
| `physics_chinook` | Derived: base warmer than summit + W/SW wind | Model calls out Chinook by name when true. |
| `physics_valley_channelling` | Derived: summit wind much stronger than base or summit wind > 40 km/h | Model calls out valley channelling by name when true. |

### 1.2 6am report (public)

- **Tone:** Very simple. No jargon unless we briefly explain it in plain language (e.g. “Chinook—a warm wind that can melt snow quickly”).
- **Content:** **The forecast people read:** current conditions in one or two sentences and what to expect today (`summary`). Optionally add one Stash Finder note (zone + why) and one groomer pick when relevant. Same fields as §2; Stash Finder details in §6.
- **Exceptional physics:** If inversion, Chinook, or other standout physics are happening, **call them out in one short, educational sentence** in the summary so the public learns (e.g. “We’re in an inversion—cold air is trapped in the valley, so the base can be much colder than the top.”).

### 1.3 Re-runs after 6am (before 10am)

- When the **resort** publishes a new snow report after 06:00 (typically ~05:30), the pipeline **regenerates the public (6am-style) report**.
- Re-run **as many times as needed** as long as the trigger time is **before 10:00**. After 10:00, do not auto re-run for that day’s “morning” cycle.
- Ensures the narrative stays in sync with the latest resort numbers and open/groomed status.

---

## 2. Output format

Structured JSON so the frontend can slot it into the UI without parsing prose. Applies to the **6am (public)** and re-run reports; the **4am (technical)** report may use the same schema with longer, more technical `summary` and optional extra fields (e.g. `snow_forecast_12h`, `wind_direction_forecast`, `best_skiing_from_wind`) if needed.

**Primary output:** `summary` — the forecast people read (conditions now + what to expect). Optional: `stash_name` / `stash_note` (Stash Finder card) and `groomer_pick` (Groomer Check).

| Field | Purpose |
|-------|--------|
| `summary` | **The forecast.** One or two sentences: conditions right now and what to expect. This is the main narrative people read on the HUD. |
| `stash_name` | Optional. Short zone name for the STASH FINDER card (e.g. "The Horseshoe", "Larch & The Glades"). Omit if no stash. Maps to **STASH_NAME** in the template. |
| `stash_note` | Optional. One sentence: *why* wind or aspect is favouring snow there. Omit if no stash. Maps to **STASH_WHY** in the template. |
| `groomer_pick` | Optional. One groomed run to highlight (Groomer Check). Only suggest **open** runs; never recommend closed terrain. |

**Example (public):**

```json
{
  "summary": "Strong inversion—base foggy, summit clear. Cold snow in the valley; orographic lift on West Bowl may add a few cm by afternoon.",
  "stash_name": "The Horseshoe",
  "stash_note": "NW flow loading the backside; A–I Gullies and Paradise lee holding cold snow.",
  "groomer_pick": "Upper Wiwaxy if you want a clean carve before the crowd."
}
```

---

## 3. Tone and rules

- **Mountain Guide:** Authoritative, honest, no marketing. Same voice as [CONTENT_LOGIC](CONTENT_LOGIC.md).
- **Only mention history when `history_alert` is present** — e.g. “On this day in 2019…”.
- **Never suggest closed runs** — Groomer Check must only reference open, groomed terrain from resort XML.
- **Short.** Summary (the forecast): 1–2 sentences. Stash/groomer: one sentence each when present.
- **No hedging fluff** — “might”, “could be” only when the underlying alert is uncertain; otherwise state what the data says.
- **Exceptional weather physics:** Whenever inversion, Chinook, orographic lift, valley channelling, freezing level, or Arctic outbreak / cold air pooling are active, **call them out and educate** — briefly explain what's happening and why. See §1.1 and [MODELS_ROCKIES_OPERATIONS](MODELS_ROCKIES_OPERATIONS.md).

---

## 4. Where it’s used

- **Stored:** Lambda writes the parsed JSON into Live_Log / FRONTEND_META (or equivalent); see [ARCHITECTURE](ARCHITECTURE.md).
- **Served:** Frontend (wx.lakeloui.se) reads it from the same payload as the rest of the HUD (temp, wind, alerts) and renders **`summary`** as the main forecast people read (hero / narrative block). When present, `stash_name` and `stash_note` fill the STASH FINDER card; `groomer_pick` fills its section.
- **Refresh:** LLM is called on the schedule in §1 (4am technical, 6am public) and when the resort publishes a new report before 10am (re-run public). Otherwise the last narrative is reused.

---

## 5. Fallback

If the LLM call fails or returns invalid JSON:

- Keep and display the **previous** forecast (summary + optional stash/groomer) if one exists.
- If none exists, show a minimal fallback: e.g. “Conditions from sensors and models; forecast unavailable.” Do not show raw alerts as prose in place of the forecast.

---

## 6. Stash Finder (optional part of the forecast)

The **STASH FINDER** card is an optional slice of the same report: where wind or aspect is favouring snow. When the forecast includes a stash, the LLM fills `stash_name` and `stash_note`; otherwise both are omitted.

### 6.1 Input to the LLM

- **Wind direction** (summit/base from WeatherLink or forecast): NW/W, SW, or E/NE drives which zone is favoured (see [CONTENT_LOGIC](CONTENT_LOGIC.md) §VII).
- **Orographic / wind alerts:** e.g. “Orographic lift on West Bowl from W flow,” “NW loading the backside.”
- **Operational gates:** Resort XML `status="Open"` for Paradise, Summit Chair, Larch, etc. **Never name a zone that requires a closed lift** (e.g. don’t suggest The Horseshoe if Summit Chair is closed).

### 6.2 Output

- **`stash_name`** (optional): Short zone label for the card—e.g. “The Horseshoe,” “Larch & The Glades,” “West Bowl & Front Side.” Omit when there is no stash; the frontend can show “Today’s stash” or hide the card.
- **`stash_note`** (optional): One sentence explaining *why*—wind direction, loading/lee, orographic. Maps to **STASH_WHY** in the template. Omit when no stash.

### 6.3 Rules

- **Omit both** when there is no clear stash (e.g. light/variable wind, no favourable aspect, or gates closed for the favoured zone).
- **One sentence** for `stash_note`. No lists; Mountain Guide voice.
- **Never suggest closed terrain** — if Paradise or Summit Chair is closed, do not recommend The Horseshoe, West Bowl, or other terrain that depends on them; suggest Larch/glades only if Larch is open.
- **Data-driven:** Use the wind direction and orographic alerts passed in; don’t invent zones or wind.

### 6.4 Wind → zone reference (from CONTENT_LOGIC §VII)

| Wind | Primary stash zone | Tactical “why” |
|------|--------------------|----------------|
| **NW / W** | The Horseshoe (A–I Gullies, Brown Cow, Paradise, East & Crow Bowls) | NW “Snow Hose”—scours front, loads NE-facing backside. Requires Paradise + Summit Chair open. |
| **SW** | Larch & The Glades | SW flow up Bow Valley; loads Larch glades. Larch Express open. |
| **E / NE** | West Bowl & Front Side Gullies | “Townsite Storm”—hits west-facing slopes. Summit Chair open. |

### 6.5 Examples

- With stash (NW, gates open): `"stash_name": "The Horseshoe"`, `"stash_note": "NW flow loading the backside; A–I Gullies and Paradise lee holding cold snow."`
- With stash (SW): `"stash_name": "Larch & The Glades"`, `"stash_note": "SW energy moving up the valley; Larch glades loading."`
- No stash (e.g. light/variable or gates closed): omit `stash_name` and `stash_note`.

---

*Next: add example prompts, schema version, or link to the actual API response shape once implemented.*
