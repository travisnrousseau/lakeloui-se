/**
 * Pre-render Midnight Alpine index.html from template and live data.
 */
import { HTML_TEMPLATE, escapeHtml } from "./template.js";
import { upperDepthCm, orographicMultiplier, depthCmFromSwe, ELEV_PIKA_M, ELEV_SUMMIT_M, ELEV_BASE_M } from "./snowMath.js";
import type { ForecastPeriod, ForecastDay, DetailedForecast } from "./mscModels.js";
import type { PikaStationData, SkokiStationData } from "./pikaSkoki.js";

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
  /** Canadian model detailed forecast (GeoMet HRDPS, RDPS, GDPS) */
  detailedForecast?: {
    hrdps?: ForecastPeriod[];
    rdps?: ForecastPeriod[];
    rdps7d?: ForecastPeriod[];
    gdps7d?: ForecastPeriod[];
    rdps7dDays?: ForecastDay[];
    gdps7dDays?: ForecastDay[];
    gdpsTrend?: string;
    verticalProfile?: { level: number; temp: number }[];
    pm25?: number | null;
  } | null;
  /** Consensus forecast timeline (HRDPS → RDPS → GDPS) for Lake Louise */
  forecastTimeline?: ForecastPeriod[];
  aiScript?: string;
  stashName?: string;
  stashWhy?: string;
  /** Card label for stash area: "04:00 REPORT" (4am) or "STASH FINDER" (6am/public). */
  stashCardLabel?: string;
  inversionActive?: boolean;
  heavySnow?: boolean;
  snowReport?: SnowReportData | null;
  /** ISO timestamp when snow report was last updated (resort XML fetch) */
  snowReportUpdatedAt?: string;
  /** GOES/WaterOffice real-time hydrometric data (Bow, Pipestone, Louise Creek) */
  waterOffice?: Array<{ stationId: string; name: string; timestamp: string; value: number; unit: string; parameter: string }>;
  /** GOES-18 Pika Run & Skoki (ACIS / Alberta River Basins); preferred for this card */
  goesStations?: { pika?: PikaStationData | null; skoki?: SkokiStationData | null };
  sparklineSummit?: string;
  sparklineBase?: string;
}

function formatTimeMST(): string {
  const now = new Date();
  const mst = new Date(now.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
  return mst.toTimeString().slice(0, 5);
}

/** Parse WaterOffice timestamp (UTC or ISO) and format as "HH:MM MST" or "DD Mon, HH:MM MST" */
function formatWaterOfficeTime(ts: string): string {
  try {
    const d = new Date(ts.trim());
    if (Number.isNaN(d.getTime())) return ts;
    const mst = new Date(d.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const time = mst.toTimeString().slice(0, 5);
    const today = new Date();
    const todayMst = new Date(today.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const isToday = mst.getDate() === todayMst.getDate() && mst.getMonth() === todayMst.getMonth() && mst.getFullYear() === todayMst.getFullYear();
    if (isToday) return `${time} MST`;
    const dateStr = mst.toLocaleDateString("en-CA", { day: "numeric", month: "short" });
    return `${dateStr}, ${time} MST`;
  } catch {
    return ts;
  }
}

/** Edmonton (Alberta) offset in hours: MST = -7, MDT = -6. DST: 2nd Sun Mar – 1st Sun Nov. */
function getEdmontonOffsetHours(year: number, month: number, day: number): number {
  if (month < 3 || (month === 3 && day < 8)) return -7; // Jan, Feb, or Mar 1–7
  if (month > 11 || (month === 11 && day > 7)) return -7; // Nov 8+, Dec
  if (month > 3 && month < 11) return -6; // Apr–Oct
  if (month === 3) {
    const secondSunday = 8 + (14 - new Date(year, 2, 1).getDay()) % 7;
    return day < secondSunday ? -7 : -6;
  }
  const firstSunday = 1 + (7 - new Date(year, 10, 1).getDay()) % 7;
  return day < firstSunday ? -6 : -7;
}

/**
 * Parse Pika/Skoki timestamp ("YYYY-MM-DD HH:mm:ss") as Mountain Time (America/Edmonton)
 * and format as "HH:MM MST" or "DD Mon, HH:MM MST". Rivers.alberta.ca returns times in Alberta local time.
 */
function formatPikaSkokiTimeMST(ts: string): string {
  try {
    const trimmed = ts.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!match) return formatWaterOfficeTime(trimmed);
    const [, y, mo, d, h, mi, s] = match;
    const year = parseInt(y!, 10);
    const month = parseInt(mo!, 10);
    const day = parseInt(d!, 10);
    const hour = parseInt(h!, 10);
    const min = parseInt(mi!, 10);
    const sec = parseInt(s!, 10);
    const offsetHours = getEdmontonOffsetHours(year, month, day);
    const utcHour = hour - offsetHours;
    const utcDate = new Date(Date.UTC(year, month - 1, day, utcHour, min, sec));
    if (Number.isNaN(utcDate.getTime())) return trimmed;
    const mst = new Date(utcDate.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const time = mst.toTimeString().slice(0, 5);
    const today = new Date();
    const todayMst = new Date(today.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
    const isToday =
      mst.getDate() === todayMst.getDate() &&
      mst.getMonth() === todayMst.getMonth() &&
      mst.getFullYear() === todayMst.getFullYear();
    const label = offsetHours === -7 ? "MST" : "MDT";
    if (isToday) return `${time} ${label}`;
    const dateStr = mst.toLocaleDateString("en-CA", { day: "numeric", month: "short" });
    return `${dateStr}, ${time} ${label}`;
  } catch {
    return ts;
  }
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

/** Human-readable label for a lead time (MST). */
function labelForLeadHours(leadHours: number): string {
  const now = new Date();
  const t = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
  const mst = new Date(t.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
  const hour = mst.getHours();
  const day = mst.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Edmonton" });
  if (hour >= 0 && hour < 6) return `${day} night`;
  if (hour >= 6 && hour < 12) return `${day} AM`;
  if (hour >= 12 && hour < 18) return `${day} PM`;
  return `${day} eve`;
}

/** Short label for table header: "Fri 14:00" (weekday + time MST). */
function formatLeadTimeShort(leadHours: number): string {
  const now = new Date();
  const t = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
  const mst = new Date(t.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
  const weekday = mst.toLocaleDateString("en-CA", { weekday: "short", timeZone: "America/Edmonton" });
  const time = mst.toTimeString().slice(0, 5);
  return `${weekday} ${time}`;
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

/** Default temp °C for SLR when station temp missing (mid-mountain). */
const DEFAULT_STATION_TEMP_C = -5;

/** Build HTML block for precip periods: one line per period. API gives mm (liquid equiv.). When tempC provided, also shows cm snow (SLR). */
function formatPrecipPeriodsSnowEquiv(
  p: { precip12hMm?: number; precip24hMm?: number; precip48hMm?: number; precip7dMm?: number },
  tempC?: number | null
): string {
  const t = tempC != null && Number.isFinite(tempC) ? tempC : DEFAULT_STATION_TEMP_C;
  const parts: string[] = [];
  const add = (label: string, mm: number | null | undefined) => {
    if (mm == null) return;
    const cmSnow = Math.round(depthCmFromSwe(mm, t) * 10) / 10;
    parts.push(`${escapeHtml(label)} ${escapeHtml(String(mm))} mm liquid equiv. <strong>(${escapeHtml(String(cmSnow))} cm snow)</strong>`);
  };
  add("12h", p.precip12hMm);
  add("24h", p.precip24hMm);
  add("48h", p.precip48hMm);
  add("7d", p.precip7dMm);
  if (parts.length === 0) return "—";
  return `<div class="snow-equiv-periods">${parts.map((line) => `<span>${line}</span>`).join("")}</div>`;
}

/** Default summit temp °C when WeatherLink missing (conservative SLR for calculated upper snow). */
const DEFAULT_SUMMIT_TEMP_C = -5;

/**
 * Calculated upper-mountain snow (cm) from Pika precip: orographic multiplier + SLR from summit temp.
 * Returns 12h, 24h, 48h, 7d snow depth in cm, or null when Pika data missing.
 */
function calculatedUpperSnowCm(
  pika: { precip12hMm?: number; precip24hMm?: number; precip48hMm?: number; precip7dMm?: number },
  summitTempC: number | null | undefined
): { snow12hCm: number; snow24hCm: number; snow48hCm: number; snow7dCm: number } | null {
  const hasPika =
    pika.precip12hMm != null ||
    pika.precip24hMm != null ||
    pika.precip48hMm != null ||
    pika.precip7dMm != null;
  if (!hasPika) return null;
  const t = summitTempC != null && Number.isFinite(summitTempC) ? summitTempC : DEFAULT_SUMMIT_TEMP_C;
  const mult = orographicMultiplier(ELEV_PIKA_M, ELEV_SUMMIT_M);
  const u12 = (pika.precip12hMm ?? 0) * mult;
  const u24 = (pika.precip24hMm ?? 0) * mult;
  const u48 = (pika.precip48hMm ?? 0) * mult;
  const u7d = (pika.precip7dMm ?? 0) * mult;
  return {
    snow12hCm: Math.round(depthCmFromSwe(u12, t) * 10) / 10,
    snow24hCm: Math.round(depthCmFromSwe(u24, t) * 10) / 10,
    snow48hCm: Math.round(depthCmFromSwe(u48, t) * 10) / 10,
    snow7dCm: Math.round(depthCmFromSwe(u7d, t) * 10) / 10
  };
}

/** Build GOES card HTML from Pika and Skoki station data (~10 km apart). Optional summit temp °C for calculated upper snow. */
function renderGoesPikaSkokiCard(
  goesStations: { pika?: PikaStationData | null; skoki?: SkokiStationData | null },
  summitTempC?: number | null
): string {
  const pika = goesStations.pika ?? null;
  const skoki = goesStations.skoki ?? null;
  const lines: string[] = [];
  if (pika) {
    const pikaExtra: string[] = [];
    if (pika.tempC != null) pikaExtra.push(`${Math.round(pika.tempC)}°C`);
    if (pika.snowDepthCm != null) pikaExtra.push(`${pika.snowDepthCm} cm snow`);
    if (pika.windSpeedKmh != null) pikaExtra.push(`${Math.round(pika.windSpeedKmh)} km/h wind`);
    const periodsHtml = formatPrecipPeriodsSnowEquiv(pika, pika.tempC);
    const right = pikaExtra.length ? pikaExtra.join(" · ") : "";
    lines.push(
      `<div class="snow-row"><span class="snow-label">Pika Run (mid)</span><span class="snow-cm">${right || (periodsHtml === "—" ? "—" : "")}</span></div>`,
      periodsHtml !== "—" ? periodsHtml : "",
      pika.timestamp ? `<p class="snow-updated" style="font-size:0.75rem;margin-top:6px;">${escapeHtml(formatPikaSkokiTimeMST(pika.timestamp))}</p>` : ""
    );
  } else {
    lines.push(
      '<div class="snow-row"><span class="snow-label">Pika Run (mid)</span><span class="snow-cm">—</span></div>'
    );
  }
  if (skoki) {
    const skokiExtra: string[] = [];
    if (skoki.sweMm != null) skokiExtra.push(`SWE ${skoki.sweMm} mm`);
    if (skoki.snowDepthCm != null) skokiExtra.push(`${skoki.snowDepthCm} cm depth`);
    if (skoki.tempC != null) skokiExtra.push(`${Math.round(skoki.tempC)}°C`);
    const periodsHtml = formatPrecipPeriodsSnowEquiv(skoki, skoki.tempC);
    const right = skokiExtra.length ? skokiExtra.join(" · ") : "";
    lines.push(
      `<div class="snow-row"><span class="snow-label">Skoki (pillow)</span><span class="snow-cm">${right || (periodsHtml === "—" ? "—" : "")}</span></div>`,
      periodsHtml !== "—" ? periodsHtml : "",
      skoki.timestamp ? `<p class="snow-updated" style="font-size:0.75rem;margin-top:6px;">${escapeHtml(formatPikaSkokiTimeMST(skoki.timestamp))}</p>` : ""
    );
  } else {
    lines.push(
      '<div class="snow-row"><span class="snow-label">Skoki (pillow)</span><span class="snow-cm">—</span></div>'
    );
  }
  const upperCalc = pika ? calculatedUpperSnowCm(pika, summitTempC) : null;
  if (upperCalc) {
    const parts: string[] = [];
    parts.push(`12h ${upperCalc.snow12hCm} cm snow`);
    parts.push(`24h ${upperCalc.snow24hCm} cm snow`);
    parts.push(`48h ${upperCalc.snow48hCm} cm snow`);
    parts.push(`7d ${upperCalc.snow7dCm} cm snow`);
    lines.push(
      '<div class="snow-row"><span class="snow-label">Upper (calculated)</span><span class="snow-cm"></span></div>',
      `<div class="snow-equiv-periods">${parts.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</div>`,
      '<p class="snow-updated" style="font-size:0.7rem;margin-top:4px;color:var(--gray);">From Pika precip × orographic × SLR (summit temp).</p>'
    );
  }
  const sourceNote = pika || skoki
    ? "GOES-18 · ACIS / Alberta River Basins"
    : "Data when source configured. See DATA_SOURCES §2.";
  return [
    `<p class="snow-conditions text-muted" style="font-size:0.75rem;margin-bottom:var(--u);">~10 km apart · ${sourceNote}</p>`,
    '<div class="snow-periods">',
    ...lines.filter(Boolean),
    "</div>"
  ].join("");
}

/** Build GOES (WaterOffice) card HTML from real-time hydrometric data. Group by station; show latest discharge and level per station. */
function renderGoesWaterOfficeCard(
  waterOffice: Array<{ stationId: string; name: string; timestamp: string; value: number; unit: string; parameter: string }>
): string {
  const byStation = new Map<string, typeof waterOffice>();
  for (const row of waterOffice) {
    const key = row.stationId;
    if (!byStation.has(key)) byStation.set(key, []);
    byStation.get(key)!.push(row);
  }
  const order = ["05BA001", "05BA002", "05BA004"];
  const lines: string[] = [];
  for (const stationId of order) {
    const rows = byStation.get(stationId);
    if (!rows?.length) continue;
    const dischargeRows = rows.filter((r) => (r.parameter || "").toLowerCase().includes("discharge")).sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    const levelRows = rows.filter((r) => (r.parameter || "").toLowerCase().includes("water") && (r.parameter || "").toLowerCase().includes("level")).sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    const latestDischarge = dischargeRows[0];
    const latestLevel = levelRows[0];
    const name = rows[0]?.name ?? stationId;
    const latestTs = [latestDischarge?.timestamp, latestLevel?.timestamp].filter(Boolean).sort().pop() ?? "";
    const parts: string[] = [];
    if (latestDischarge != null) parts.push(`Discharge ${latestDischarge.value} ${latestDischarge.unit}`);
    if (latestLevel != null) parts.push(`Level ${latestLevel.value} ${latestLevel.unit}`);
    lines.push(
      `<div class="snow-row"><span class="snow-label">${escapeHtml(name)}</span><span class="snow-cm">${parts.join(" · ") || "—"}</span></div>`,
      latestTs ? `<p class="snow-updated" style="font-size:0.75rem;margin-top:2px;">${escapeHtml(formatWaterOfficeTime(latestTs))}</p>` : ""
    );
  }
  if (lines.length === 0) return '<p class="snow-conditions text-muted">GOES data will appear when available.</p>';
  return [
    '<p class="snow-conditions text-muted" style="font-size:0.75rem;margin-bottom:var(--u);">Real-time GOES · WaterOffice (EC)</p>',
    '<div class="snow-periods">',
    ...lines.filter(Boolean),
    "</div>"
  ].join("");
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

/** Render a prominent SVG timeline (temp line colored warm/cold + precip bars) for the bento. No caption — caller puts "Precip bars" below. */
function renderForecastSvg(hrdps: ForecastPeriod[] | undefined, rdps: ForecastPeriod[] | undefined): string {
  const leads = getLeadsFromData(hrdps, rdps);
  const getPeriod = (arr: ForecastPeriod[] | undefined, lead: number) => (arr || []).find(p => p.leadHours === lead) ?? null;
  const hrdpsPts = leads.map(l => getPeriod(hrdps, l));
  const hasAny = hrdpsPts.some(p => p && (p.tempBase != null || p.tempSummit != null));
  if (!hasAny) return "";

  const width = 720;
  const height = 180;
  const padding = 32;
  const plotH = height - 2 * padding - 24;

  const allTemps = (hrdps || []).concat(rdps || []).flatMap(p => [p.tempBase, p.tempSummit]).filter((t): t is number => t != null && Number.isFinite(t));
  const minT = allTemps.length ? Math.min(...allTemps) : -10;
  const maxT = allTemps.length ? Math.max(...allTemps) : 5;
  const rangeT = Math.max(0.1, maxT - minT);
  const getY = (t: number) => padding + ((maxT - t) / rangeT) * plotH;
  const getX = (i: number) => (leads.length <= 1 ? width / 2 : padding + (i / (leads.length - 1)) * (width - 2 * padding));

  const pts = hrdpsPts.map((p, i) => {
    const avg = p ? ((p.tempBase ?? (minT + maxT) / 2) + (p.tempSummit ?? (minT + maxT) / 2)) / 2 : (minT + maxT) / 2;
    return { x: getX(i), y: getY(avg), t: avg };
  });

  const strokeCold = "#00d4ff";
  const strokeWarm = "#ff8c00";
  const pathSegments: string[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const midT = (a.t + b.t) / 2;
    const stroke = midT <= 0 ? strokeCold : strokeWarm;
    pathSegments.push(`<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const tempPaths = pathSegments.join("\n        ");

  const precipByLead: Record<number, number | null> = {};
  const isSnowByLead: Record<number, boolean> = {};
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const h = getPeriod(hrdps, lead);
    const r = getPeriod(rdps, lead);
    const v = h?.precipMm ?? r?.precipMm ?? null;
    const prevLead = i > 0 ? leads[i - 1]! : null;
    const prevV = prevLead != null ? (getPeriod(hrdps, prevLead)?.precipMm ?? getPeriod(rdps, prevLead)?.precipMm ?? 0) : 0;
    const inc = v != null && Number.isFinite(v) ? Math.max(0, v - (Number.isFinite(prevV) ? prevV : 0)) : null;
    precipByLead[lead] = inc != null && inc > 0 ? inc : null;
    const baseT = h?.tempBase ?? r?.tempBase ?? null;
    const meanT = ((h?.tempBase ?? NaN) + (h?.tempSummit ?? NaN)) / 2;
    const temp = Number.isFinite(baseT ?? NaN) ? baseT! : meanT;
    isSnowByLead[lead] = Number.isFinite(temp) ? temp <= 0 : true;
  }
  const precipVals = Object.values(precipByLead).filter((v): v is number => v != null && Number.isFinite(v));
  const maxPrecip = precipVals.length ? Math.max(...precipVals) : 0;
  const barH = 28;
  const barW = Math.max(10, Math.min(28, (width - 2 * padding) / leads.length - 4));
  const barRects = leads.map((lead, i) => {
    const mm = precipByLead[lead];
    if (mm == null || mm <= 0) return "";
    const h = maxPrecip > 0 ? (mm / maxPrecip) * barH : 0;
    const x = getX(i) - barW / 2;
    const y = height - padding - h;
    const snow = isSnowByLead[lead];
    const fill = snow ? "#6eb5ff" : "#64748b";
    const title = snow ? `${mm.toFixed(1)} mm → snow` : `${mm.toFixed(1)} mm rain`;
    return `<rect class="precip-bar" x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${fill}" title="${title}" />`;
  }).join("");

  const yZero = getY(0);
  const tickLabels = leads.map((lead, i) => {
    const x = getX(i);
    const short = labelForLeadHours(lead).split(" ")[0];
    return `<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--gray,#888)">${short}</text>`;
  }).join("");

  return `
    <div class="forecast-viz" style="display:block;min-height:220px;height:auto;margin:0 0 24px 0;padding:var(--u2) 0;background:linear-gradient(to bottom, rgba(0,212,255,0.06) 0%, transparent 50%, rgba(255,140,0,0.06) 100%);border-radius:12px;border:1px solid rgba(255,255,255,0.08);box-sizing:border-box;">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="width:100%;max-width:720px;height:180px;display:block;vertical-align:top;">
        <line x1="${padding}" y1="${yZero}" x2="${width - padding}" y2="${yZero}" stroke="#fff" stroke-width="2" stroke-dasharray="6 4" opacity="0.9"/>
        <text x="${padding}" y="${yZero - 6}" font-size="12" font-weight="700" fill="#fff">0°C</text>
        ${tempPaths}
        ${barRects}
        ${tickLabels}
      </svg>
    </div>`;
}

/** Default leads when data has none (fallback). Last column 42h → Sun ~08:46. */
const DEFAULT_FORECAST_LEADS = [0, 3, 6, 12, 18, 24, 36, 42];

/** 7-day table column leads (one per day). */
const SEVEN_DAY_LEADS = [24, 48, 72, 96, 120, 144, 168];

/** Render Next 7 days table with daily low/high for base and summit. */
function renderForecast7DayTable(
  rdps7dDays: ForecastDay[],
  gdps7dDays: ForecastDay[]
): string {
  const getDay = (arr: ForecastDay[], lead: number) => arr.find((d) => d.leadHours === lead) ?? null;

  const precipDisplay = (
    mm: number | null | undefined,
    baseTemp: number | null | undefined
  ) => {
    if (mm == null || !Number.isFinite(mm) || mm <= 0) return "—";
    if (!Number.isFinite(baseTemp ?? NaN)) return `${Math.round(mm)} mm (precip)`;
    if ((baseTemp ?? 0) > 1) return `${Math.round(mm)} mm rain`;
    if ((baseTemp ?? 0) >= 0 && (baseTemp ?? 0) <= 1) return `${Math.round(mm)} mm mix`;
    let ratio = 10;
    if ((baseTemp ?? 0) <= -10) ratio = 20;
    else if ((baseTemp ?? 0) <= -5) ratio = 15;
    else if ((baseTemp ?? 0) <= -1) ratio = 12;
    const snowCm = (mm / ratio) * 10;
    return `${Math.round(snowCm)} cm snow`;
  };

  const cellForDay = (days: ForecastDay[], lead: number) => {
    const d = getDay(days, lead);
    if (!d) return `<div class="forecast-cell-empty">—</div>`;
    const baseLow = d.tempBaseLow != null && Number.isFinite(d.tempBaseLow) ? Math.round(d.tempBaseLow) : null;
    const baseHigh = d.tempBaseHigh != null && Number.isFinite(d.tempBaseHigh) ? Math.round(d.tempBaseHigh) : null;
    const summitLow = d.tempSummitLow != null && Number.isFinite(d.tempSummitLow) ? Math.round(d.tempSummitLow) : null;
    const summitHigh = d.tempSummitHigh != null && Number.isFinite(d.tempSummitHigh) ? Math.round(d.tempSummitHigh) : null;
    const meanBase = baseLow != null && baseHigh != null ? (baseLow + baseHigh) / 2 : (baseLow ?? baseHigh ?? NaN);
    const meanSummit = summitLow != null && summitHigh != null ? (summitLow + summitHigh) / 2 : (summitLow ?? summitHigh ?? NaN);
    const meanTemp = Number.isFinite(meanBase) && Number.isFinite(meanSummit) ? (meanBase + meanSummit) / 2 : meanBase ?? meanSummit ?? NaN;
    const inversion = baseHigh != null && summitLow != null && summitLow > baseHigh;
    let bg = "#222";
    if (Number.isFinite(meanTemp)) {
      if (meanTemp <= -5) bg = "#073b4c";
      else if (meanTemp <= 0) bg = "#0a5366";
      else if (meanTemp <= 1) bg = "#2b2b2b";
      else bg = "#6b3b00";
    }
    if (inversion) bg = "#3d2b1a";
    const border = inversion ? "1px solid #ff5f00" : "1px solid transparent";
    const baseStr = baseLow != null && baseHigh != null ? `${baseLow}° / ${baseHigh}°` : (baseLow != null || baseHigh != null ? `${baseLow ?? baseHigh}°` : "—");
    const summitStr = summitLow != null && summitHigh != null ? `${summitLow}° / ${summitHigh}°` : (summitLow != null || summitHigh != null ? `${summitLow ?? summitHigh}°` : "—");
    const precipStr = precipDisplay(d.precipMm ?? null, baseHigh ?? meanBase ?? null);
    const windStr =
      d.windSpeed != null && Number.isFinite(d.windSpeed)
        ? `${Math.round(d.windSpeed)} km/h ${d.windDir != null && Number.isFinite(d.windDir) ? windDirFromDeg(d.windDir) : "—"}`
        : "—";
    return `<div class="forecast-cell" style="background:${bg};border:${border};padding:8px;border-radius:8px;color:#fff;text-align:center;min-width:64px;">
              <div style="font-size:0.8rem;color:#ddd;">Base: ${baseStr}</div>
              <div style="font-size:0.8rem;color:#ddd;margin-top:2px;">Summit: ${summitStr}</div>
              <div style="font-size:0.75rem;color:#aaa;margin-top:4px;">${precipStr}</div>
              <div style="font-size:0.75rem;color:#aaa;margin-top:2px;">${escapeHtml(windStr)}</div>
            </div>`;
  };

  const headerCols = SEVEN_DAY_LEADS.map((l) => `<th style="padding:6px;text-align:center;"><div style="font-weight:700;">${formatLeadTimeShort(l)}</div><div style="font-size:0.75rem;color:var(--gray);font-weight:400;">${l}h</div></th>`).join("");
  const col1 = SEVEN_DAY_LEADS.map((l) => `<td>${cellForDay(rdps7dDays, l)}</td>`).join("");
  const col2 = SEVEN_DAY_LEADS.map((l) => `<td>${cellForDay(gdps7dDays, l)}</td>`).join("");

  return `
    <div class="forecast-bento" style="width:100%;display:block;overflow:visible;">
      <div style="margin-top:0;display:block;">
        <p style="margin:24px 0 12px 0;font-weight:700;font-size:1.1rem;">Next 7 days</p>
        <div style="overflow-x:auto;margin-top:12px;-webkit-overflow-scrolling:touch;">
          <table style="width:100%;min-width:560px;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;width:120px;min-width:80px;">Model</th>
                ${headerCols}
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding:8px;font-weight:700;">RDPS</td>${col1}</tr>
              <tr><td style="padding:8px;font-weight:700;">GDPS</td>${col2}</tr>
            </tbody>
          </table>
        </div>
        <p style="margin-top:10px;color:var(--gray);font-size:0.8rem;">Rain vs snow: from base temp. Orange border = inversion. RDPS · GDPS (7-day, daily low/high).</p>
      </div>
    </div>`;
}

/** Collect unique lead hours from period arrays, sorted (0, 3, 6, …). */
function getLeadsFromData(arr1: ForecastPeriod[] | undefined, arr2: ForecastPeriod[] | undefined): number[] {
  const set = new Set<number>();
  for (const p of arr1 ?? []) set.add(p.leadHours);
  for (const p of arr2 ?? []) set.add(p.leadHours);
  const leads = [...set].sort((a, b) => a - b);
  return leads.length > 0 ? leads : DEFAULT_FORECAST_LEADS;
}

/** Render the 48h forecast as a simple table: NAM/GFS or legacy HRDPS/RDPS. When tableOnly, no SVG or Next 24h (for 7-day RDPS/GDPS). */
function renderForecastBento(
  arr1: ForecastPeriod[] | undefined,
  arr2: ForecastPeriod[] | undefined,
  label1: string = "HRDPS",
  label2: string = "RDPS",
  tableOnly: boolean = false
): string {
  const leads = getLeadsFromData(arr1, arr2);
  const getPeriod = (arr: ForecastPeriod[] | undefined, lead: number) => (arr || []).find(p => p.leadHours === lead) ?? null;

  /** Precip label: always state rain vs snow. Use base temp when available (rain/snow at base matters most). */
  const precipDisplay = (
    mm: number | null | undefined,
    meanTemp: number | null | undefined,
    baseTemp: number | null | undefined
  ) => {
    if (mm == null || !Number.isFinite(mm) || mm <= 0) return "—";
    const temp = Number.isFinite(baseTemp ?? NaN) ? baseTemp! : meanTemp ?? null;
    if (!Number.isFinite(temp ?? NaN)) return `${Math.round(mm)} mm (precip)`;
    if ((temp ?? 0) > 1) return `${Math.round(mm)} mm rain`;
    if ((temp ?? 0) >= 0 && (temp ?? 0) <= 1) return `${Math.round(mm)} mm mix`;
    let ratio = 10;
    if ((temp ?? 0) <= -10) ratio = 20;
    else if ((temp ?? 0) <= -5) ratio = 15;
    else if ((temp ?? 0) <= -1) ratio = 12;
    const snowCm = (mm / ratio) * 10;
    return `${Math.round(snowCm)} cm snow`;
  };

  // GeoMet Total Precipitation is accumulated from ref time; 24h lead value = 0–24h total (do not sum all leads)
  let next24SnowCm = 0;
  const period24h = getPeriod(arr1, 24) ?? getPeriod(arr2, 24);
  if (period24h?.precipMm != null && Number.isFinite(period24h.precipMm) && period24h.precipMm > 0) {
    const meanTemp = ((period24h.tempBase ?? NaN) + (period24h.tempSummit ?? NaN)) / 2;
    if (Number.isFinite(meanTemp) && meanTemp <= 1) {
      let ratio = 10;
      if (meanTemp <= -10) ratio = 20;
      else if (meanTemp <= -5) ratio = 15;
      else if (meanTemp <= -1) ratio = 12;
      next24SnowCm = (period24h.precipMm / ratio) * 10;
    }
  }

  /** Per-period precip: GeoMet returns accumulated from ref time; show increment (this period) = value(lead) - value(prev_lead). */
  const precipIncrementMm = (modelArr: ForecastPeriod[] | undefined, lead: number, precipFallback: ForecastPeriod[] | undefined): number | null => {
    const idx = leads.indexOf(lead);
    const prevLead = idx > 0 ? leads[idx - 1]! : null;
    const curr = getPeriod(modelArr, lead) ?? getPeriod(precipFallback, lead);
    const prev = prevLead != null ? (getPeriod(modelArr, prevLead) ?? getPeriod(precipFallback, prevLead)) : null;
    const currMm = curr?.precipMm ?? null;
    const prevMm = prev?.precipMm ?? 0;
    if (currMm == null || !Number.isFinite(currMm)) return null;
    const inc = Math.max(0, currMm - (Number.isFinite(prevMm) ? prevMm : 0));
    return inc > 0 ? inc : null;
  };

  /** When precipFallback is set (e.g. RDPS), use its precip for display when this row has none — so HRDPS row shows RDPS snow when HRDPS layer unavailable. */
  const cellFor = (
    modelArr: ForecastPeriod[] | undefined,
    lead: number,
    precipFallback?: ForecastPeriod[] | undefined
  ) => {
    const p = getPeriod(modelArr, lead);
    if (!p) return `<div class="forecast-cell-empty">—</div>`;
    const base = p.tempBase != null && Number.isFinite(p.tempBase) ? Math.round(p.tempBase) : null;
    const summit = p.tempSummit != null && Number.isFinite(p.tempSummit) ? Math.round(p.tempSummit) : null;
    const meanTemp = (base != null && summit != null) ? (base + summit) / 2 : (base ?? summit ?? NaN);
    const inversion = base != null && summit != null && summit > base;
    let bg = "#222";
    if (Number.isFinite(meanTemp)) {
      if (meanTemp <= -5) bg = "#073b4c";
      else if (meanTemp <= 0) bg = "#0a5366";
      else if (meanTemp <= 1) bg = "#2b2b2b";
      else bg = "#6b3b00";
    }
    if (inversion) bg = "#3d2b1a";
    const border = inversion ? "1px solid #ff5f00" : "1px solid transparent";
    const summitPart = summit != null ? `${summit}°` : "—";
    const basePart = base != null ? `${base}°` : "—";
    const tempStr = `${summitPart} / ${basePart}`;
    const precipMm = precipIncrementMm(modelArr, lead, precipFallback ?? []);
    const precipTemp = p;
    const precipStr = precipDisplay(precipMm ?? null, (precipTemp?.tempBase != null && precipTemp?.tempSummit != null) ? (precipTemp.tempBase + precipTemp.tempSummit) / 2 : meanTemp, precipTemp?.tempBase ?? p.tempBase ?? null);
    const windSpeed = (p.windSpeed != null && Number.isFinite(p.windSpeed))
      ? p.windSpeed
      : (precipFallback ? getPeriod(precipFallback, lead)?.windSpeed : null) ?? null;
    const windDir = (p.windDir != null && Number.isFinite(p.windDir))
      ? p.windDir
      : (precipFallback ? getPeriod(precipFallback, lead)?.windDir : null) ?? null;
    const windStr =
      windSpeed != null && Number.isFinite(windSpeed)
        ? `${Math.round(windSpeed)} km/h ${windDir != null && Number.isFinite(windDir) ? windDirFromDeg(windDir) : "—"}`
        : "—";
    return `<div class="forecast-cell" style="background:${bg};border:${border};padding:8px;border-radius:8px;color:#fff;text-align:center;min-width:64px;">
              <div style="font-weight:700;font-size:1rem;line-height:1.2;">${tempStr}</div>
              <div style="font-size:0.8rem;color:#ddd;margin-top:4px;">${precipStr}</div>
              <div style="font-size:0.75rem;color:#aaa;margin-top:2px;">${escapeHtml(windStr)}</div>
            </div>`;
  };

  const headerCols = leads.map(l => `<th style="padding:6px;text-align:center;"><div style="font-weight:700;">${formatLeadTimeShort(l)}</div><div style="font-size:0.75rem;color:var(--gray);font-weight:400;">${l}h</div></th>`).join("");
  const col1 = leads.map(l => `<td>${cellFor(arr1, l, arr2)}</td>`).join("");
  const col2 = leads.map(l => `<td>${cellFor(arr2, l)}</td>`).join("");

  const svgBlock = tableOnly ? "" : renderForecastSvg(arr1, arr2);
  let next24RainMm = 0;
  if (!tableOnly && period24h?.precipMm != null && Number.isFinite(period24h.precipMm) && period24h.precipMm > 0) {
    const baseT = period24h.tempBase ?? period24h.tempSummit ?? NaN;
    if (Number.isFinite(baseT) && baseT > 1) next24RainMm = period24h.precipMm;
  }
  const next24Line =
    !tableOnly && (next24SnowCm > 0 || next24RainMm > 0)
      ? `<p style="margin:0 0 12px 0;font-weight:700;font-size:1rem;">Next 24h: ${next24SnowCm > 0 ? `~${Math.round(next24SnowCm)} cm snow` : ""}${next24SnowCm > 0 && next24RainMm > 0 ? "; " : ""}${next24RainMm > 0 ? `${Math.round(next24RainMm)} mm rain` : ""}</p>`
      : "";
  const precipBarsLine = tableOnly ? "" : "<p style=\"margin:0 0 16px 0;font-size:0.8rem;color:var(--gray);\">Precip bars: blue = snow, slate = rain.</p>";
  const caption = tableOnly
    ? "Rain vs snow: from base temp. Orange border = inversion. RDPS · GDPS (7-day)."
    : "Rain vs snow: from base temp (cold = snow cm, warm = rain mm). Orange border = inversion. HRDPS row uses RDPS precip and wind when HRDPS layers unavailable. HRDPS · RDPS.";
  const sectionTitle = tableOnly ? "<p style=\"margin:24px 0 12px 0;font-weight:700;font-size:1.1rem;\">Next 7 days</p>" : "";
  return `
    <div class="forecast-bento" style="width:100%;display:block;overflow:visible;">
      ${svgBlock}
      ${precipBarsLine}
      <div style="margin-top:0;display:block;">
        ${sectionTitle}
        ${next24Line}
        <div style="overflow-x:auto;margin-top:12px;-webkit-overflow-scrolling:touch;">
          <table style="width:100%;min-width:560px;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;width:120px;min-width:80px;">Model</th>
                ${headerCols}
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding:8px;font-weight:700;">${label1}</td>${col1}</tr>
              <tr><td style="padding:8px;font-weight:700;">${label2}</td>${col2}</tr>
            </tbody>
          </table>
        </div>
        <p style="margin-top:10px;color:var(--gray);font-size:0.8rem;">${caption}</p>
      </div>
    </div>
  `;
}

export function renderHtml(data: RenderData): string {
  const summit = data.weather?.[0];
  const base = data.weather?.[1];
  const baseCardClass = data.inversionActive ? "inversion-active" : "";
  const bodyClass = data.heavySnow ? "snow-overlay" : "";
  
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

  const summitWindMeta = summit?.data_ts != null ? formatWindAsOf(summit.data_ts) : "";
  const baseWindMeta = base?.data_ts != null ? formatWindAsOf(base.data_ts) : "";

  const df = data.detailedForecast;
  const has7dDays = df != null && (df.rdps7dDays?.length ?? 0) > 0 && (df.gdps7dDays?.length ?? 0) > 0;
  const has7d = df != null && ((df.rdps7d?.length ?? 0) > 0 || (df.gdps7d?.length ?? 0) > 0);
  const sevenDayBlock = has7dDays && df
    ? renderForecast7DayTable(df.rdps7dDays!, df.gdps7dDays!)
    : has7d && df
      ? renderForecastBento(df.rdps7d, df.gdps7d, "RDPS", "GDPS", true)
      : "<div class=\"forecast-bento\" style=\"width:100%;display:block;margin-top:24px;\"><p style=\"margin:0 0 12px 0;font-weight:700;font-size:1.1rem;\">Next 7 days</p><p style=\"color:var(--gray);font-size:0.9rem;\">RDPS · GDPS (7-day table refreshes with model data; run dry-render again if empty).</p></div>";
  const forecastBento = df
    ? renderForecastBento(df.hrdps, df.rdps) + sevenDayBlock
    : '<p class="snow-conditions text-muted">Forecast will appear when model data is available.</p>';

  const verticalHeatmap = data.detailedForecast?.verticalProfile?.length
    ? renderVerticalHeatmap(data.detailedForecast.verticalProfile)
    : "";

  const goesCardHtml = data.goesStations != null
    ? renderGoesPikaSkokiCard(data.goesStations, data.weather?.[0]?.temp)
    : data.waterOffice?.length
      ? renderGoesWaterOfficeCard(data.waterOffice)
      : '<p class="snow-conditions text-muted">Pika & Skoki (GOES-18) — data when source is configured.</p>';

  const replacements: Record<string, string> = {
    "{{HERO_BEANS}}": escapeHtml(data.aiScript ?? "Welcome to the mountain."),
    "{{SUMMIT_TEMP}}": summitTemp,
    "{{BASE_TEMP}}": baseTemp,
    "{{SUMMIT_FEELS_LIKE}}": summitFeelsLike,
    "{{BASE_FEELS_LIKE}}": baseFeelsLike,
    "{{BASE_CARD_CLASS}}": baseCardClass,
    "{{BODY_CLASS}}": bodyClass,
    "{{BODY_STYLE}}": "",
    "{{TIME}}": formatTimeMST(),
    "{{STASH_CARD_LABEL}}": escapeHtml(data.stashCardLabel ?? "STASH FINDER"),
    "{{STASH_NAME}}": escapeHtml(data.stashName ?? "Saddleback / Larch"),
    "{{STASH_WHY}}": escapeHtml(data.stashWhy ?? "Groomed runs are a safer bet when conditions are uncertain."),
    "{{SUMMIT_WIND}}": summitWind,
    "{{BASE_WIND}}": baseWind,
    "{{SUMMIT_WIND_META}}": summitWindMeta ? `<span class="wind-meta">${escapeHtml(summitWindMeta)}</span>` : "",
    "{{BASE_WIND_META}}": baseWindMeta ? `<span class="wind-meta">${escapeHtml(baseWindMeta)}</span>` : "",
    "{{SNOW_REPORT_CARD}}": goesCardHtml,
    "{{SPARKLINE_SUMMIT}}": data.sparklineSummit ?? defaultSparkline(),
    "{{SPARKLINE_BASE}}": data.sparklineBase ?? defaultSparkline(),
    "{{FORECAST_MODELS_DESC}}": "HRDPS (2.5 km) · RDPS (10 km). Summit / base temp; precip as snow (cm) or rain (mm) from base temp.",
    "{{FORECAST_BENTO}}": forecastBento,
    "{{VERTICAL_HEATMAP}}": verticalHeatmap,
    "{{GDPS_TREND}}": escapeHtml(
      (data.detailedForecast?.gdpsTrend ?? "Data unavailable.").replace(/^(Extended|Long-range)\s*\(7-day\)\s*trend:\s*/i, "")
    ),
  };

  let html = HTML_TEMPLATE;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.split(key).join(value);
  }
  return html;
}
