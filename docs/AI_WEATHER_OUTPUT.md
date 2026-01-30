# AI Weather Output (wx.lakeloui.se)

Spec for the **LLM-generated weather/ski narrative** served at wx.lakeloui.se. The Lambda turns sensors + models into structured alerts; the LLM turns those alerts into short, human-readable copy. This doc defines that output.

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

- **Tone:** Technical but clear. Use terms like *orographic lift*, *inversion*, *Chinook*, *freezing level*, *valley channelling* — and **define or explain them in one short phrase** so a new Snow Reporter can learn.
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

### 1.2 6am report (public)

- **Tone:** Very simple. No jargon unless we briefly explain it in plain language (e.g. “Chinook—a warm wind that can melt snow quickly”).
- **Content:** Current conditions in one or two sentences; what to expect today; one optional stash note and one groomer pick when relevant. Same fields as §2 (summary, stash_note, groomer_pick).
- **Exceptional physics:** If inversion, Chinook, or other standout physics are happening, **call them out in one short, educational sentence** so the public learns (e.g. “We’re in an inversion—cold air is trapped in the valley, so the base can be much colder than the top.”).

### 1.3 Re-runs after 6am (before 10am)

- When the **resort** publishes a new snow report after 06:00 (typically ~05:30), the pipeline **regenerates the public (6am-style) report**.
- Re-run **as many times as needed** as long as the trigger time is **before 10:00**. After 10:00, do not auto re-run for that day’s “morning” cycle.
- Ensures the narrative stays in sync with the latest resort numbers and open/groomed status.

---

## 2. Output format

Structured JSON so the frontend can slot it into the UI without parsing prose. Applies to the **6am (public)** and re-run reports; the **4am (technical)** report may use the same schema with longer, more technical `summary` and optional extra fields (e.g. `snow_forecast_12h`, `wind_direction_forecast`, `best_skiing_from_wind`) if needed.

| Field | Purpose |
|-------|--------|
| `summary` | One or two sentences: conditions right now and what to expect. Main “weather read” for the HUD. |
| `stash_note` | Optional. Where wind or aspect is favouring snow (Stash Finder). Omit if no stash alert. |
| `groomer_pick` | Optional. One groomed run to highlight (Groomer Check). Only suggest **open** runs; never recommend closed terrain. |

**Example (public):**

```json
{
  "summary": "Strong inversion—base foggy, summit clear. Cold snow in the valley; orographic lift on West Bowl may add a few cm by afternoon.",
  "stash_note": "West-facing lee of Paradise Ridge holding; wind from the west.",
  "groomer_pick": "Upper Wiwaxy if you want a clean carve before the crowd."
}
```

---

## 3. Tone and rules

- **Mountain Guide:** Authoritative, honest, no marketing. Same voice as [CONTENT_LOGIC](CONTENT_LOGIC.md).
- **Only mention history when `history_alert` is present** — e.g. “On this day in 2019…”.
- **Never suggest closed runs** — Groomer Check must only reference open, groomed terrain from resort XML.
- **Short.** Summary: 1–2 sentences. Stash/groomer: one sentence each when present.
- **No hedging fluff** — “might”, “could be” only when the underlying alert is uncertain; otherwise state what the data says.
- **Exceptional weather physics:** Whenever inversion, Chinook, orographic lift, valley channelling, freezing level, or Arctic outbreak / cold air pooling are active, **call them out and educate** — briefly explain what's happening and why. See §1.1 and [MODELS_ROCKIES_OPERATIONS](MODELS_ROCKIES_OPERATIONS.md).

---

## 4. Where it’s used

- **Stored:** Lambda writes the parsed JSON into Live_Log / FRONTEND_META (or equivalent); see [ARCHITECTURE](ARCHITECTURE.md).
- **Served:** Frontend (wx.lakeloui.se) reads it from the same payload as the rest of the HUD (temp, wind, alerts) and renders `summary` as the main narrative block; `stash_note` and `groomer_pick` in their sections when present.
- **Refresh:** LLM is called on the schedule in §1 (4am technical, 6am public) and when the resort publishes a new report before 10am (re-run public). Otherwise the last narrative is reused.

---

## 5. Fallback

If the LLM call fails or returns invalid JSON:

- Keep and display the **previous** narrative if one exists.
- If none exists, show a minimal fallback: e.g. “Conditions from sensors and models; narrative unavailable.” Do not show raw alerts as prose in place of the narrative.

---

*Next: add example prompts, schema version, or link to the actual API response shape once implemented.*
