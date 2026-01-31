/**
 * OpenRouter client for the forecast narrative (summary + optional stash + groomer).
 * Model and system prompt are configurable via env or file.
 */

import { readFileSync } from "fs";
import { existsSync } from "fs";
import { join } from "path";
import axios from "axios";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Env: OpenRouter API key (required to call). Set OPENROUTER_API_KEY locally or in Lambda. */
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

/** Env: Model id (e.g. google/gemini-2.0-flash-001, openai/gpt-4o-mini). */
export const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";

/** Env: Full system prompt string. If set, overrides file. */
const OPENROUTER_SYSTEM_PROMPT_ENV = process.env.OPENROUTER_SYSTEM_PROMPT ?? "";

/** Env: Path to file containing system prompt (used if OPENROUTER_SYSTEM_PROMPT not set). */
const OPENROUTER_SYSTEM_PROMPT_FILE =
  process.env.OPENROUTER_SYSTEM_PROMPT_FILE ?? "";

/** Env: System prompt for 4am (Snow Reporters) report. Overrides file when set. */
const OPENROUTER_SYSTEM_PROMPT_4AM_ENV = process.env.OPENROUTER_SYSTEM_PROMPT_4AM ?? "";
/** Env: Path to file for 4am system prompt (used if OPENROUTER_SYSTEM_PROMPT_4AM not set). */
const OPENROUTER_SYSTEM_PROMPT_FILE_4AM = process.env.OPENROUTER_SYSTEM_PROMPT_FILE_4AM ?? "";

/** Report type: 4am = technical for Snow Reporters (AI_WEATHER_OUTPUT §1.1), 6am = public. */
export type ReportType = "4am" | "6am";

/** Default system prompt aligned with docs/AI_WEATHER_OUTPUT.md (tone, format, rules, Stash Finder). */
const DEFAULT_SYSTEM_PROMPT = `You are the weather/ski forecaster for Lake Louise (lakeloui.se). You produce the forecast people read. Tone: Mountain Guide — authoritative, honest, no marketing. Same voice as CONTENT_LOGIC.

Output: Reply with exactly one JSON object, no markdown or extra text. This is the only output.
{
  "summary": "The forecast. 1–2 sentences: conditions right now and what to expect. This is the main narrative people read.",
  "stash_name": "Required. Short zone or area name. Prefer a wind/aspect stash when data supports it (only open terrain). When no clear stash or conditions unknown, use a groomer suggestion: e.g. Saddleback, Larch, or Richardson. Never use 'The Horseshoe' or 'Horseshoe'.",
  "stash_note": "Required. One sentence: why that area (wind loading, aspect, or that groomed runs are a safer bet when conditions are uncertain). Only reference open runs/areas.",
  "groomer_pick": "Optional. One groomed run to highlight. Only pick from groomed_runs in the payload (open runs only). Omit if none."
}

Rules (from AI_WEATHER_OUTPUT):
- Never use "we", "we've", "we're", or "our". Use impersonal phrasing: "There has been…", "There is…", "Conditions are…", "Temperatures will…". Example: "There has been a dusting of 1 cm in the last 24 hours" not "We've had a dusting…".
- Only mention history when the payload has a non-null history_alert (e.g. "On this day in 2019…").
- **Resort report changes:** When the payload has resort_report_changes (lifts opened/closed, newly groomed, snow amounts updated), work it into the summary in one short phrase so readers know what changed (e.g. "Resort updated: 3 cm overnight; Larch Express now open" or "Snow report revised — 5 cm in 24 h"). Do not repeat the raw string; paraphrase naturally.
- Never suggest closed runs or terrain that requires a closed lift. Groomer pick must be from groomed_runs; stash zone must be reachable with open_lifts. Never use the name "The Horseshoe" or "Horseshoe".
- Short. Summary: 1–2 sentences. Stash note and groomer pick: one sentence each when present.
- No hedging fluff — use "might" or "could" only when the data is uncertain; otherwise state what the data says.
- Exceptional physics: When inversion, Chinook, orographic lift, or similar is in play, call it out in the summary in one short, educational sentence (e.g. "We're in an inversion—cold air is trapped in the valley, so the base can be much colder than the top."). Do not state their absence (e.g. do not say "no inversion" or "no Chinook expected"); only mention them when they are happening. No jargon without a brief plain-language explainer.

Stash Finder — always return a suggestion (stash_name and stash_note required):
- **Always suggest something.** Prefer a wind/aspect stash when data supports it and the zone is open. When conditions are unknown or no clear wind stash, suggest groomers: Saddleback, Larch, or Richardson area are safer bets. Never leave stash_name or stash_note empty.
- **Only open terrain:** Suggest only zones and runs reachable with open_lifts. Never mention closed areas, lifts, or runs. Groomer pick must be from groomed_runs only.
- **Frontside vs backside:** Frontside = West Bowl only. Backside = Whitehorn, Eagle Ridge (ER), Paradise, East Bowl, Crow Bowl. Larch & The Glades are backside (Larch Express). Only name a zone if its access lift(s) are in open_lifts.
- **Base stash_name and stash_note on:** (1) **Overnight:** snow_overnight_cm, snow_24h_cm; summit_wind_dir_deg/base_wind_dir_deg — wind loads snow on the lee side (e.g. NW → Paradise lee; W → backside lee). (2) **Through the day:** forecast_day_summary and forecast_12h_* — wind shift, precip timing. (3) **Clouds:** infer from conditions; mention in stash_note when relevant. When uncertain, default to a groomer suggestion (Saddleback, Larch, Richardson) with stash_note like "Groomed runs are a safer bet when conditions are uncertain."
- **Wind → zone (only if open):** NW/W → Paradise lee, East Bowl, Crow Bowl (needs Paradise + Summit Chair). SW → Larch & The Glades (Larch Express). E/NE → West Bowl (Summit Chair). Always verify required lifts are in open_lifts. Never use the name "The Horseshoe" or "Horseshoe".
- Data-driven: use only what the payload provides; do not invent numbers.

Output only valid JSON.`;

/** Default 4am (Snow Reporters) system prompt — AI_WEATHER_OUTPUT §1.1: technical, educational. */
const DEFAULT_SYSTEM_PROMPT_4AM = `You are the weather forecaster for Lake Louise Snow Reporters (04:00 technical report). Tone: Technical but easy to understand. Use terms like orographic lift, inversion, Chinook, freezing level, valley channelling — and explain each in one short phrase so a new Snow Reporter can learn.

The payload includes explicit data so you can call out scientific happenings accurately:

(1) **Pika / new snow (use Pika only; do not cite Skoki):** You have two sources: (a) Resort snow report: snow_24h_cm, snow_overnight_cm, snow_report_observed_at. (b) GOES-18 Pika pillow: pika_goes_12h_mm, pika_goes_24h_mm, pika_goes_48h_mm, pika_goes_7d_mm, pika_goes_observed_at. **Always use and cite only Pika** in the narrative (Skoki is for context; do not mention Skoki in the summary). When resort snow_24h_cm/snow_overnight_cm are null or zero, use Pika GOES data: state "Pika (GOES-18) at [time]: X mm liquid in 12h, Y mm in 24h" and approximate snow cm when below freezing (~1.5 cm per mm liquid). When both resort and Pika GOES are present, prefer Pika GOES for precise accumulations; include observation time (e.g. "Pika at 17:45 MST — 2.4 mm in 12h, 2.7 mm in 24h (about 3.6 cm snow 12h)").

(2) **Next 12 h (HRDPS/RDPS):** When forecast_12h_precip_mm, forecast_12h_wind_kmh, forecast_12h_wind_dir_deg, forecast_12h_temp_base_c, forecast_12h_temp_summit_c are present, use them for "snow forecast in the next 12 hours" and "wind direction forecast". State approximate precip (mm liquid → snow cm when below freezing), wind direction, and temps. Explain why (e.g. orographic lift from W flow) when physics_orographic is true.

(3) **Freezing level:** When freezing_level_m is present, state it (e.g. "Freezing level near 2100 m — snow at summit, possible mix at base") and what it means for rain vs snow.

(4) **Physics flags (call out by name only when true):**
- inversion_active → Inversion: cold air trapped in valley; base colder than summit; explain briefly.
- physics_chinook → Chinook: warm dry downslope wind; snow eater; melt-freeze crust risk; explain briefly.
- physics_orographic → Orographic lift: air forced up by terrain; snow enhanced on windward slopes; explain briefly.
- physics_valley_channelling → Valley channelling: wind funnelled through valleys; stronger at ridge; wind-hold risk; explain briefly.
Do not state the absence of these (e.g. do not say "There is no inversion", "no Chinook expected", "no orographic lift", or "no valley channelling"). Only mention them when their flag is true; speak about them positively when they are happening.

Output: Reply with exactly one JSON object, no markdown or extra text.
{
  "summary": "The technical brief in exactly 4 to 6 sentences. Use the payload fields above. Include: Pika new snow from pika_goes_* (and/or resort snow_24h_cm/snow_overnight_cm); cite Pika only, with observation time. Next 12h snow/wind from forecast_12h_* when present. Freezing level when freezing_level_m present. Call out inversion, Chinook, orographic, valley channelling by name only when their flags are true; do not mention them when false. Wind and best skiing from wind direction. 4–6 sentences only.",
  "stash_name": "Optional. Omit for 4am report.",
  "stash_note": "Optional. Omit for 4am report.",
  "groomer_pick": "Optional. Omit for 4am report."
}

Rules:
- Never use "we", "we've", "we're", or "our". Use impersonal phrasing: "There has been…", "Pika at 04:00 — …", "Conditions…".
- Exactly 4 to 6 sentences. Technical but easy to understand.
- Use only data from the payload; do not invent numbers. When a field is null or missing, omit or say "not available".
- Do not state that inversion, Chinook, orographic lift, or valley channelling are absent or not expected. Only mention them when they are active (flags true); then speak about them positively.
- Goal: Snow Reporters get a precise, educational brief that correctly reflects model and sensor data.

Output only valid JSON.`;

/**
 * Resolve the system prompt: env string > file path > default. For reportType "4am" uses 4am-specific env/file/default.
 */
export function getSystemPrompt(reportType: ReportType = "6am"): string {
  if (reportType === "4am") {
    if (OPENROUTER_SYSTEM_PROMPT_4AM_ENV.length > 0) return OPENROUTER_SYSTEM_PROMPT_4AM_ENV;
    if (OPENROUTER_SYSTEM_PROMPT_FILE_4AM.length > 0) {
      const path = OPENROUTER_SYSTEM_PROMPT_FILE_4AM.startsWith("/")
        ? OPENROUTER_SYSTEM_PROMPT_FILE_4AM
        : join(process.cwd(), OPENROUTER_SYSTEM_PROMPT_FILE_4AM);
      if (existsSync(path)) {
        try {
          return readFileSync(path, "utf-8").trim();
        } catch (e) {
          console.warn("OpenRouter: failed to read 4am system prompt file:", e);
        }
      }
    }
    return DEFAULT_SYSTEM_PROMPT_4AM;
  }
  if (OPENROUTER_SYSTEM_PROMPT_ENV.length > 0) {
    return OPENROUTER_SYSTEM_PROMPT_ENV;
  }
  if (OPENROUTER_SYSTEM_PROMPT_FILE.length > 0) {
    const path = OPENROUTER_SYSTEM_PROMPT_FILE.startsWith("/")
      ? OPENROUTER_SYSTEM_PROMPT_FILE
      : join(process.cwd(), OPENROUTER_SYSTEM_PROMPT_FILE);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8").trim();
      } catch (e) {
        console.warn("OpenRouter: failed to read system prompt file:", e);
      }
    }
  }
  return DEFAULT_SYSTEM_PROMPT;
}

export interface ForecastPayload {
  summit_temp_c?: number | null;
  base_temp_c?: number | null;
  summit_wind_kmh?: number | null;
  base_wind_kmh?: number | null;
  summit_wind_dir_deg?: number | null;
  base_wind_dir_deg?: number | null;
  inversion_active?: boolean;
  snow_24h_cm?: number | null;
  snow_overnight_cm?: number | null;
  open_lifts?: string[];
  groomed_runs?: string[];
  history_alert?: string | null;
  /** 4am report: when the snow report (Pika) was last updated (e.g. "04:00" or ISO). */
  snow_report_observed_at?: string | null;
  /** 4am report: HRDPS/RDPS precip (mm liquid) next 12h — sum of 0–12h leads. */
  forecast_12h_precip_mm?: number | null;
  /** 4am report: model wind (km/h) and dir (deg) for ~6–12h. */
  forecast_12h_wind_kmh?: number | null;
  forecast_12h_wind_dir_deg?: number | null;
  /** 4am report: model base/summit temp (°C) for ~6–12h. */
  forecast_12h_temp_base_c?: number | null;
  forecast_12h_temp_summit_c?: number | null;
  /** 4am report: freezing level (m ASL or hPa — see payload source). Null if not available. */
  freezing_level_m?: number | null;
  /** 4am report: explicit physics flags so model can call out scientific happenings. */
  physics_orographic?: boolean;
  physics_chinook?: boolean;
  physics_valley_channelling?: boolean;
  /** 6am: short text summary of forecast through the day (wind, precip, temps by period) for Stash Finder + clouds. */
  forecast_day_summary?: string | null;
  /** 6am re-run: short summary of what changed in resort report (lifts opened/closed, newly groomed, snow amounts) so the model can call it out (AI_WEATHER_OUTPUT §1.3). */
  resort_report_changes?: string | null;
  /** 4am: GOES-18 Pika Run pillow — precip mm (12h/24h/48h/7d) and observation time. Use Pika for narrative; do not cite Skoki. */
  pika_goes_12h_mm?: number | null;
  pika_goes_24h_mm?: number | null;
  pika_goes_48h_mm?: number | null;
  pika_goes_7d_mm?: number | null;
  pika_goes_observed_at?: string | null;
  /** 4am: GOES-18 Skoki pillow — for context only; do not cite in summary. */
  skoki_goes_12h_mm?: number | null;
  skoki_goes_24h_mm?: number | null;
  skoki_goes_48h_mm?: number | null;
  skoki_goes_7d_mm?: number | null;
  skoki_goes_observed_at?: string | null;
  [key: string]: unknown;
}

export interface ForecastResult {
  summary: string;
  stash_name?: string | null;
  stash_note?: string | null;
  groomer_pick?: string | null;
}

/**
 * Call OpenRouter chat/completions; parse response as ForecastResult.
 * reportType "4am" uses the technical (Snow Reporters) system prompt; "6am" uses the public prompt.
 * Returns null if disabled (no API key), request fails, or response is not valid JSON.
 */
export async function generateForecast(
  payload: ForecastPayload,
  reportType: ReportType = "6am"
): Promise<ForecastResult | null> {
  if (!OPENROUTER_API_KEY) {
    console.warn("OpenRouter: OPENROUTER_API_KEY not set, skipping.");
    return null;
  }
  const systemPrompt = getSystemPrompt(reportType);
  const userContent =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 0);
  console.log("OpenRouter: reportType=" + reportType + " model=" + OPENROUTER_MODEL + " payload keys=" + Object.keys(payload).join(","));

  try {
    const res = await axios.post<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 512,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lakeloui.se",
        },
        timeout: 30_000,
      }
    );

    const raw =
      res.data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      console.warn("OpenRouter: empty response content. choices=", JSON.stringify(res.data?.choices).slice(0, 200));
      return null;
    }
    console.log("OpenRouter: raw response length=", raw.length, "preview=", raw.slice(0, 120) + (raw.length > 120 ? "..." : ""));

    // Strip optional markdown code fence
    let jsonStr = raw;
    const codeMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
    if (codeMatch) jsonStr = codeMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    if (!summary) {
      console.warn("OpenRouter: parsed JSON missing or empty summary. keys=", Object.keys(parsed).join(","));
      return null;
    }

    return {
      summary,
      stash_name:
        typeof parsed.stash_name === "string" ? parsed.stash_name : null,
      stash_note:
        typeof parsed.stash_note === "string" ? parsed.stash_note : null,
      groomer_pick:
        typeof parsed.groomer_pick === "string" ? parsed.groomer_pick : null,
    };
  } catch (err: unknown) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.error("OpenRouter forecast generation failed:", ax?.message ?? err);
    if (ax?.response) {
      console.error("OpenRouter response status:", ax.response.status, "data:", JSON.stringify(ax.response.data).slice(0, 400));
    }
    return null;
  }
}
