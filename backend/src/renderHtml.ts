/**
 * Pre-render Midnight Alpine index.html from template and live data.
 */
import { HTML_TEMPLATE, escapeHtml } from "./template.js";
import { upperDepthCm, ELEV_PIKA_M, ELEV_SUMMIT_M, ELEV_BASE_M } from "./snowMath.js";
import type { ForecastPeriod, DetailedForecast } from "./mscModels.js";

export interface SnowReportData {
  name: string;
  base: number;
  snowOverNight: number;
  snow24Hours: number;
  snow48Hours: number;
  snow7Days: number;
  snowYearToDate: number;
  temperature: number;
  weatherConditions: string;
  primarySurface?: string;
  secondarySurface?: string;
  lastSnowfallDate?: string;
  lastSnowfallUpdate?: string;
}

export interface RenderData {
  weather?: Array<{
    temp?: number;
    wind_speed?: number;
    wind_direction_deg?: number;
    feels_like?: number;
    bar_sea_level?: number;
    /** WeatherLink station timestamp (Unix sec) — when this reading is from */
    data_ts?: number;
  }>;
  msc?: { hrdps?: Record<string, { temp850?: number; temp700?: number }> };
  /** Consensus forecast timeline (HRDPS → RDPS → GDPS) for Lake Louise */
  forecastTimeline?: ForecastPeriod[];
  detailedForecast?: DetailedForecast;
  aiScript?: string;
  stashName?: string;
  stashWhy?: string;
  inversionActive?: boolean;
  heavySnow?: boolean;
  snowReport?: SnowReportData | null;
  /** ISO timestamp when snow report was last updated (resort XML fetch) */
  snowReportUpdatedAt?: string;
  sparklineSummit?: string;
  sparklineBase?: string;
}

function formatTimeMST(): string {
  const now = new Date();
  const mst = new Date(now.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
  return mst.toTimeString().slice(0, 5);
}

function windDirFromDeg(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const i = Math.round(((deg % 360) / 360) * 16) % 16;
  return dirs[i];
}

/** Format WeatherLink station timestamp (Unix sec) as "As of HH:MM MST" in MST */
function formatWindAsOf(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    const mst = new Date(d.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const time = mst.toTimeString().slice(0, 5);
    return `As of ${time} MST`;
  } catch {
    return "";
  }
}

/** Default sparkline path (gentle curve) */
function defaultSparkline(): string {
  return "M0 20 Q 25 10, 50 25 T 100 20";
}

/** Format ISO timestamp as "Last updated at HH:MM MST" or "Last updated at Mon DD, HH:MM MST" in MST */
function formatSnowReportUpdatedAt(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const mst = new Date(d.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const time = mst.toTimeString().slice(0, 5);
    const dateStr = mst.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Edmonton" });
    const today = new Date();
    const todayMst = new Date(today.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const isToday = mst.getDate() === todayMst.getDate() && mst.getMonth() === todayMst.getMonth() && mst.getFullYear() === todayMst.getFullYear();
    return isToday ? `Last updated at ${time} MST` : `Last updated ${dateStr}, ${time} MST`;
  } catch {
    return "";
  }
}

/** Upper mountain depth using SLR + orographic multiplier; fallback 1.5× when temps missing */
function upperSnowCm(
  midCm: number,
  tMid_C: number | null | undefined,
  tUpper_C: number | null | undefined
): number {
  return upperDepthCm(midCm, tMid_C, tUpper_C, ELEV_PIKA_M, ELEV_SUMMIT_M);
}

/** Wind redistribution note when wind strong: loading on lee, scouring on windward */
function windRedistributionNote(
  windSpeed_kmh: number | undefined,
  windDirDeg: number | undefined
): string {
  if (windSpeed_kmh == null || windDirDeg == null || windSpeed_kmh < 25) return "";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const i = Math.round(((windDirDeg % 360) / 360) * 16) % 16;
  const fromDir = dirs[i];
  const opp = dirs[(i + 8) % 16];
  return `Strong ${fromDir} wind — loading on ${opp} aspects, scouring on ${fromDir}.`;
}

/** Render the vertical heatmap bar. */
function renderVerticalHeatmap(profile: { level: number; temp: number }[]): string {
  if (profile.length === 0) return "";
  
  // Map levels to approximate elevations (m)
  // 1000mb ~ 100m, 925mb ~ 750m, 850mb ~ 1500m, 700mb ~ 3000m, 500mb ~ 5500m
  const segments = profile.map(p => {
    let color = "#00d4ff"; // Cold blue
    if (p.temp > 0) color = "#ff5f00"; // Warm orange
    else if (p.temp > -5) color = "#fff"; // Near freezing white
    return `<div class="heatmap-segment" style="background: ${color}; opacity: ${Math.min(1, Math.abs(p.temp)/10 + 0.3)};"></div>`;
  });

  return `<div class="vertical-heatmap">${segments.join("")}</div>`;
}

/** Render the Bento forecast card with confidence band. */
function renderForecastBento(hrdps: ForecastPeriod[], rdps: ForecastPeriod[]): string {
  if (hrdps.length === 0) return '<p class="snow-conditions text-muted">Forecast data unavailable.</p>';

  // Debug: log incoming forecast arrays so we can verify values at runtime
  try {
    // eslint-disable-next-line no-console
    console.log("renderForecastBento - HRDPS periods:", JSON.stringify(hrdps.map((p, i) => ({ idx: i, tBase: p.tempBase, tSum: p.tempSummit }))), "RDPS periods:", JSON.stringify(rdps.map((p, i) => ({ idx: i, tBase: p.tempBase, tSum: p.tempSummit }))));
  } catch (e) {
    // ignore
  }

  const width = 800;
  const height = 120;
  const padding = 20;
  
  const allTemps = [...hrdps, ...rdps].flatMap(p => [p.tempBase, p.tempSummit]).filter((t): t is number => t !== null && Number.isFinite(t));
  const minT = allTemps.length ? Math.min(...allTemps) : -10;
  const maxT = allTemps.length ? Math.max(...allTemps) : 5;
  // Avoid zero range
  const rangeT = Math.max(0.1, maxT - minT);

  const getX = (i: number, total: number) => total <= 1 ? width / 2 : padding + (i / (total - 1)) * (width - 2 * padding);
  const getY = (t: number) => {
    // Invert Y because SVG coordinates start from top
    return padding + ((maxT - t) / rangeT) * (height - 2 * padding);
  };

  // Confidence area (RDPS variance)
  const rdpsPoints = rdps.map((p, i) => ({ x: getX(i, rdps.length), yBase: getY(p.tempBase ?? (minT + maxT) / 2), ySum: getY(p.tempSummit ?? (minT + maxT) / 2) }));
  const confidencePath = rdpsPoints.length > 1 ? [
    `M ${rdpsPoints[0].x} ${rdpsPoints[0].yBase}`,
    ...rdpsPoints.slice(1).map(p => `L ${p.x} ${p.yBase}`),
    ...[...rdpsPoints].reverse().map(p => `L ${p.x} ${p.ySum}`),
    "Z"
  ].join(" ") : "";

  // Tactical line (HRDPS) - use average of base+summit for a single tactical value
  const hrdpsPoints = hrdps.map((p, i) => {
    const avg = ((p.tempBase ?? (minT + maxT) / 2) + (p.tempSummit ?? (minT + maxT) / 2)) / 2;
    return { x: getX(i, hrdps.length), y: getY(avg) };
  });
  const tacticalPath = hrdpsPoints.length > 0 ? `M ${hrdpsPoints[0].x} ${hrdpsPoints[0].y}` + (hrdpsPoints.length > 1 ? " " + hrdpsPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ") : "") : "";

  return `
    <div class="forecast-viz">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width: 100%; height: 100%;">
        ${confidencePath ? `<path class="confidence-area" d="${confidencePath}" />` : ""}
        ${tacticalPath ? `<path class="tactical-line" d="${tacticalPath}" />` : ""}
        <!-- Axis labels -->
        <line class="forecast-axis" x1="${padding}" y1="${getY(0)}" x2="${width - padding}" y2="${getY(0)}" />
        <text class="forecast-label-text" x="${padding}" y="${getY(0) - 5}">FREEZING (0°C)</text>
      </svg>
    </div>
  `;
}

export function renderHtml(data: RenderData): string {
  const summit = data.weather?.[0];
  const base = data.weather?.[1];
  const baseCardClass = data.inversionActive ? "inversion-active" : "";
  const bodyClass = data.heavySnow ? "snow-overlay" : "";
  
  // Clarity and Haze (FireWork PM2.5)
  const pm25 = data.detailedForecast?.pm25 ?? 0;
  const clarity = Math.max(0, Math.min(100, 100 - (pm25 * 2)));
  const blurPx = Math.max(0, (pm25 - 10) / 5);
  const desat = Math.max(0, pm25 / 2);
  const bodyStyle = `backdrop-filter: blur(${blurPx}px) grayscale(${desat}%);`;
  const clarityTag = `<div class="clarity-tag ${clarity < 50 ? 'clarity-alert' : ''}">CLARITY: ${Math.round(clarity)}%</div>`;

  const FEELS_LIKE_DIFF_C = 2;
  const summitTemp = summit?.temp != null ? `${Math.round(summit.temp)}°` : "--°";
  const baseTemp = base?.temp != null ? `${Math.round(base.temp)}°` : "--°";
  const summitFeelsLike =
    summit?.temp != null && summit?.feels_like != null && Math.abs(summit.feels_like - summit.temp) > FEELS_LIKE_DIFF_C
      ? `<span class="feels-like">${escapeHtml(`Feels like ${Math.round(summit.feels_like)}°`)}</span>`
      : "";
  const baseFeelsLike =
    base?.temp != null && base?.feels_like != null && Math.abs(base.feels_like - base.temp) > FEELS_LIKE_DIFF_C
      ? `<span class="feels-like">${escapeHtml(`Feels like ${Math.round(base.feels_like)}°`)}</span>`
      : "";
  const summitWind =
    summit?.wind_speed != null
      ? `${Math.round(summit.wind_speed)} KM/H ${summit.wind_direction_deg != null ? windDirFromDeg(summit.wind_direction_deg) : "—"}`
      : "-- KM/H --";
  const baseWind =
    base?.wind_speed != null
      ? `${Math.round(base.wind_speed)} KM/H ${base.wind_direction_deg != null ? windDirFromDeg(base.wind_direction_deg) : "—"}`
      : "-- KM/H --";

  const summitWindMeta = [
    summit?.data_ts != null ? formatWindAsOf(summit.data_ts) : "",
    summit?.wind_speed != null && summit?.wind_direction_deg == null ? "Direction not reported by station." : ""
  ].filter(Boolean).join(" · ");
  const baseWindMeta = [
    base?.data_ts != null ? formatWindAsOf(base.data_ts) : "",
    base?.wind_speed != null && base?.wind_direction_deg == null ? "Direction not reported by station." : ""
  ].filter(Boolean).join(" · ");

  const sr = data.snowReport;
  const tMid = sr?.temperature != null && Number.isFinite(Number(sr.temperature)) ? Number(sr.temperature) : undefined;
  const tUpperNum = summit?.temp != null && Number.isFinite(Number(summit.temp)) ? Number(summit.temp) : undefined;
  const updatedAtLine = (sr && data.snowReportUpdatedAt)
    ? `<p class="snow-updated">${escapeHtml(formatSnowReportUpdatedAt(data.snowReportUpdatedAt))}</p>`
    : "";
  const windNote = windRedistributionNote(summit?.wind_speed, summit?.wind_direction_deg);
  const windNoteHtml = windNote ? `<p class="snow-wind-note">${escapeHtml(windNote)}</p>` : "";

  const forecastBento = data.detailedForecast 
    ? renderForecastBento(data.detailedForecast.hrdps, data.detailedForecast.rdps)
    : '<p class="snow-conditions text-muted">Forecast will appear when model data is available.</p>';

  const verticalHeatmap = data.detailedForecast
    ? renderVerticalHeatmap(data.detailedForecast.verticalProfile)
    : "";

  const snowReportHtml = sr
    ? [
        `<div class="text-muted">Mid: ${escapeHtml(sr.name)}</div>`,
        `<div class="snow-periods">`,
        `<div class="snow-row"><span class="snow-label">12h (Overnight)</span><span class="snow-cm">${sr.snowOverNight} cm</span></div>`,
        `<div class="snow-row"><span class="snow-label">24h (Day)</span><span class="snow-cm">${sr.snow24Hours} cm</span></div>`,
        `<div class="snow-row"><span class="snow-label">48h (2 Days)</span><span class="snow-cm">${sr.snow48Hours} cm</span></div>`,
        `</div>`,
        `<div class="text-muted snow-upper-label">Upper mountain (est. SLR + orographic)</div>`,
        `<div class="snow-periods">`,
        `<div class="snow-row"><span class="snow-label">12h</span><span class="snow-cm">${upperSnowCm(Number(sr.snowOverNight), tMid, tUpperNum)} cm</span></div>`,
        `<div class="snow-row"><span class="snow-label">24h</span><span class="snow-cm">${upperSnowCm(Number(sr.snow24Hours), tMid, tUpperNum)} cm</span></div>`,
        `<div class="snow-row"><span class="snow-label">48h</span><span class="snow-cm">${upperSnowCm(Number(sr.snow48Hours), tMid, tUpperNum)} cm</span></div>`,
        `</div>`,
        windNoteHtml,
        sr.weatherConditions ? `<p class="snow-conditions">${escapeHtml(sr.weatherConditions)}</p>` : "",
        updatedAtLine
      ]
        .filter(Boolean)
        .join("")
    : '<p class="snow-conditions text-muted">No snow report yet. Available 03:00–15:00 MST.</p>';

  const replacements: Record<string, string> = {
    "{{HERO_BEANS}}": escapeHtml(data.aiScript ?? "Welcome to the mountain."),
    "{{SUMMIT_TEMP}}": summitTemp,
    "{{BASE_TEMP}}": baseTemp,
    "{{SUMMIT_FEELS_LIKE}}": summitFeelsLike,
    "{{BASE_FEELS_LIKE}}": baseFeelsLike,
    "{{BASE_CARD_CLASS}}": baseCardClass,
    "{{BODY_CLASS}}": bodyClass,
    "{{BODY_STYLE}}": bodyStyle,
    "{{TIME}}": formatTimeMST(),
    "{{STASH_NAME}}": escapeHtml(data.stashName ?? "THE HORSESHOE"),
    "{{STASH_WHY}}": escapeHtml(data.stashWhy ?? "Check wind and aspect for the stash."),
    "{{SUMMIT_WIND}}": summitWind,
    "{{BASE_WIND}}": baseWind,
    "{{SUMMIT_WIND_META}}": summitWindMeta ? `<span class="wind-meta">${escapeHtml(summitWindMeta)}</span>` : "",
    "{{BASE_WIND_META}}": baseWindMeta ? `<span class="wind-meta">${escapeHtml(baseWindMeta)}</span>` : "",
    "{{SNOW_REPORT_CARD}}": snowReportHtml,
    "{{SPARKLINE_SUMMIT}}": data.sparklineSummit ?? defaultSparkline(),
    "{{SPARKLINE_BASE}}": data.sparklineBase ?? defaultSparkline(),
    "{{FORECAST_BENTO}}": forecastBento,
    "{{VERTICAL_HEATMAP}}": verticalHeatmap,
    "{{GDPS_TREND}}": escapeHtml(data.detailedForecast?.gdpsTrend ?? "Long-range trend: Data unavailable."),
    "{{CLARITY_TAG}}": clarityTag,
  };

  let html = HTML_TEMPLATE;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.split(key).join(value);
  }
  return html;
}
