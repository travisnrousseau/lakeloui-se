/**
 * Canadian model forecast via GeoMet WCS (point requests).
 * Returns ForecastPeriod[] and DetailedForecast for drop-in use with render.
 * GeoMet returns latest run; we fill 6–48h using one HRDPS value (6–24h) and one GDPS value (36–48h).
 */

import type { ForecastPeriod, ForecastDay, DetailedForecast } from "./mscModels.js";
import {
  getCapabilities,
  getHrdpsTemp2m,
  getHrdpsPrecipMm,
  getHrdpsWind10m,
  getRdpsTemp2m,
  getRdpsPrecipMm,
  getRdpsWind10m,
  getRdpsWind80m,
  getGdpsTemp2m,
  getGdpsPrecipMm,
  getGdpsWind10m,
  COORDS,
  COVERAGE_IDS,
} from "./geometClient.js";
import { getSummitPointForTemp } from "./elevation.js";

/** Table leads: 0h–42h (last column Sun ~08:46); HRDPS 0–24h, GDPS 36–42h. Render uses whatever leads are present in data. */
export const FORECAST_LEADS = [0, 3, 6, 12, 18, 24, 36, 42];
const LEADS = FORECAST_LEADS;

/** Normalize ISO8601 to comparable form (no sub-ms). */
function normalizeTimeIso(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z").trim();
}

/**
 * Return subset of FORECAST_LEADS for which the layer has a valid time in GetCapabilities.
 * Avoids requesting leads GeoMet does not yet provide (e.g. 0h/3h right after run).
 */
async function getAvailableLeadsForLayer(ref: Date, layerName: string): Promise<number[]> {
  const times = await getCapabilities(layerName);
  if (times.length === 0) return [...FORECAST_LEADS];
  const set = new Set(times.map(normalizeTimeIso));
  return FORECAST_LEADS.filter((h) => set.has(normalizeTimeIso(validTimeIso(ref, h))));
}

/** Lead hours for 7-day table: one per day (24h–168h). */
export const SEVEN_DAY_LEADS = [24, 48, 72, 96, 120, 144, 168];

/** Extra leads for daily low/high: mid and end of each 24h window (12, 24, 36, 48, …, 168). */
const SEVEN_DAY_LEADS_DETAILED = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168];

/**
 * Return subset of leadSet for which the layer has a valid time in GetCapabilities.
 * Used for 7-day RDPS/GDPS table.
 * When no times match (e.g. GDPS uses different interval or format), return full leadSet
 * so we still attempt requests—GeoMet may accept the time parameter and return data.
 */
async function getAvailableLeadsInSet(
  ref: Date,
  layerName: string,
  leadSet: number[]
): Promise<number[]> {
  const times = await getCapabilities(layerName);
  if (times.length === 0) return [...leadSet];
  const validSet = new Set(times.map(normalizeTimeIso));
  const filtered = leadSet.filter((h) => validSet.has(normalizeTimeIso(validTimeIso(ref, h))));
  return filtered.length > 0 ? filtered : [...leadSet];
}

/** HRDPS runs at 00, 06, 12, 18 UTC. Return latest run time (UTC) at or before now. */
function getHrdpsReferenceTimeUtc(): Date {
  const now = new Date();
  const hour = now.getUTCHours();
  const runHour = Math.floor(hour / 6) * 6; // 0, 6, 12, 18
  const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), runHour, 0, 0, 0));
  if (ref.getTime() > now.getTime()) ref.setUTCHours(ref.getUTCHours() - 6);
  return ref;
}

/** RDPS runs at 00 and 12 UTC only (like GDPS). Return latest run time (UTC) at or before now. */
function getRdpsReferenceTimeUtc(): Date {
  const now = new Date();
  const hour = now.getUTCHours();
  const runHour = hour >= 12 ? 12 : 0;
  const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), runHour, 0, 0, 0));
  if (ref.getTime() > now.getTime()) {
    ref.setUTCDate(ref.getUTCDate() - 1);
    ref.setUTCHours(12);
  }
  return ref;
}

/** GDPS runs at 00 and 12 UTC only. Return latest run time (UTC) at or before now. */
function getGdpsReferenceTimeUtc(): Date {
  const now = new Date();
  const hour = now.getUTCHours();
  const runHour = hour >= 12 ? 12 : 0;
  const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), runHour, 0, 0, 0));
  if (ref.getTime() > now.getTime()) {
    ref.setUTCDate(ref.getUTCDate() - 1);
    ref.setUTCHours(12);
  }
  return ref;
}

/** Valid time (ISO8601) for a given lead from reference time. */
function validTimeIso(ref: Date, leadHours: number): string {
  const t = new Date(ref.getTime() + leadHours * 60 * 60 * 1000);
  return t.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Standard lapse rate °C/m (dry adiabatic / PBL); used when base and summit share one coarse cell (e.g. GDPS, RDPS). */
const LAPSE_RATE_PER_M = 0.0065;

/** RDPS 2 m temp is at this reference elevation (m); correct to base/summit from here when RDPS is available. */
export const RDPS_REF_ELEV_M = 2071;

function labelForLead(h: number): string {
  return `${h}h`;
}

/** Base temp from summit temp and elevation difference (lapse down). GDPS anchored at summit; base derived. */
function lapseCorrectBase(
  tempSummitC: number,
  elevSummitM: number,
  elevBaseM: number
): number {
  return tempSummitC + (elevSummitM - elevBaseM) * LAPSE_RATE_PER_M;
}

/** Base and summit temps from a single value at reference elevation (e.g. RDPS at 2071 m). */
export function lapseCorrectFromRef(
  tempAtRefC: number,
  elevRefM: number,
  elevBaseM: number,
  elevSummitM: number
): { baseTemp: number; summitTemp: number } {
  return {
    baseTemp: tempAtRefC + (elevRefM - elevBaseM) * LAPSE_RATE_PER_M,
    summitTemp: tempAtRefC + (elevRefM - elevSummitM) * LAPSE_RATE_PER_M,
  };
}

/** Min PBL height (m) to trust; below this assume wrong units/missing and use normal lapse. */
const PBL_HEIGHT_MIN_M = 200;

/**
 * Same as lapseCorrectFromRef but PBL-aware: if summit is above PBL height, use temp at PBL top
 * (no lapse above PBL) so inversions can show (summit not forced colder).
 * If pblHeightM is below PBL_HEIGHT_MIN_M we ignore it (likely wrong units).
 */
export function lapseCorrectFromRefWithPbl(
  tempAtRefC: number,
  elevRefM: number,
  elevBaseM: number,
  elevSummitM: number,
  pblHeightM: number | null
): { baseTemp: number; summitTemp: number } {
  const baseTemp = tempAtRefC + (elevRefM - elevBaseM) * LAPSE_RATE_PER_M;
  const usePbl =
    pblHeightM != null &&
    pblHeightM >= PBL_HEIGHT_MIN_M &&
    elevSummitM > pblHeightM;
  const summitTemp = usePbl
    ? tempAtRefC + (elevRefM - pblHeightM) * LAPSE_RATE_PER_M
    : tempAtRefC + (elevRefM - elevSummitM) * LAPSE_RATE_PER_M;
  return { baseTemp, summitTemp };
}

/** Build a single forecast period from GeoMet point values. precipMm: liquid mm; wind from HRDPS/RDPS 10 m. */
function period(
  leadHours: number,
  label: string,
  tempBase: number | null,
  tempSummit: number | null,
  source: string,
  precipMm?: number | null,
  wind?: { speedKmh: number; dirDeg: number } | null
): ForecastPeriod {
  return {
    leadHours,
    label,
    tempBase,
    tempSummit,
    windSpeed: wind?.speedKmh ?? null,
    windDir: wind?.dirDeg ?? null,
    source,
    precipMm: precipMm ?? null,
  };
}

/**
 * Consensus forecast timeline from GeoMet: HRDPS (0–24h) + GDPS (36–48h), per forecast hour (TIME).
 * Only requests leads that GeoMet GetCapabilities reports as available (avoids 0h/3h right after run).
 */
export async function fetchGeometForecastTimeline(): Promise<ForecastPeriod[]> {
  const summitPoint = await getSummitPointForTemp(
    { lat: COORDS.PARADISE.lat, lon: COORDS.PARADISE.lon },
    COORDS.PARADISE.elevM
  );
  const ref = getHrdpsReferenceTimeUtc();
  const [hrdpsLeads, gdpsLeads] = await Promise.all([
    getAvailableLeadsForLayer(ref, COVERAGE_IDS.HRDPS_2M_TEMP),
    getAvailableLeadsForLayer(ref, COVERAGE_IDS.GDPS_2M_TEMP_15KM),
  ]);
  const timelineLeads = [...new Set([
    ...hrdpsLeads.filter((h) => h <= 24),
    ...gdpsLeads.filter((h) => h >= 36),
  ])].sort((a, b) => a - b);
  const timeline: ForecastPeriod[] = [];
  for (const h of timelineLeads) {
    const time = validTimeIso(ref, h);
    const useGdps = h >= 36;
    let b: number | null = null;
    let s: number | null = null;
    let precipMm: number | null = null;
    let wind: { speedKmh: number; dirDeg: number } | null = null;
    if (useGdps) {
      [s, precipMm, wind] = await Promise.all([
        getGdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
        getGdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getGdpsWind10m(summitPoint.lat, summitPoint.lon, time),
      ]);
      b = s != null ? lapseCorrectBase(s, COORDS.PARADISE.elevM, COORDS.BASE.elevM) : null;
    } else {
      [b, s, precipMm, wind] = await Promise.all([
        getHrdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getHrdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
        getHrdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getHrdpsWind10m(summitPoint.lat, summitPoint.lon, time),
      ]);
    }
    const source = useGdps ? "GDPS" : "HRDPS";
    if (b != null || s != null) timeline.push(period(h, labelForLead(h), b, s, source, precipMm, wind));
  }
  return timeline;
}

/**
 * Detailed forecast from GeoMet: HRDPS row 0–24h, RDPS row per lead, GDPS 36–42h.
 * Only requests leads reported as available in each layer's GetCapabilities.
 */
export async function fetchGeometDetailedForecast(): Promise<DetailedForecast> {
  const summitPoint = await getSummitPointForTemp(
    { lat: COORDS.PARADISE.lat, lon: COORDS.PARADISE.lon },
    COORDS.PARADISE.elevM
  );
  const ref = getHrdpsReferenceTimeUtc();
  const [hrdpsLeads, rdpsLeads, gdpsLeads] = await Promise.all([
    getAvailableLeadsForLayer(ref, COVERAGE_IDS.HRDPS_2M_TEMP),
    getAvailableLeadsForLayer(ref, COVERAGE_IDS.RDPS_2M_TEMP),
    getAvailableLeadsForLayer(ref, COVERAGE_IDS.GDPS_2M_TEMP_15KM),
  ]);
  const timelineLeads = [...new Set([
    ...hrdpsLeads.filter((h) => h <= 24),
    ...gdpsLeads.filter((h) => h >= 36),
  ])].sort((a, b) => a - b);

  const hrdps: ForecastPeriod[] = [];
  let gdpsBase: number | null = null;
  let gdpsSummit: number | null = null;

  for (const h of timelineLeads) {
    const time = validTimeIso(ref, h);
    const useGdps = h >= 36;
    if (useGdps) {
      const [s, precipMm, wind] = await Promise.all([
        getGdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
        getGdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getGdpsWind10m(summitPoint.lat, summitPoint.lon, time),
      ]);
      const b = s != null ? lapseCorrectBase(s, COORDS.PARADISE.elevM, COORDS.BASE.elevM) : null;
      if (b != null || s != null) {
        hrdps.push(period(h, labelForLead(h), b, s, "GDPS", precipMm, wind));
        if (gdpsSummit == null) gdpsSummit = s;
        if (gdpsBase == null) gdpsBase = b;
      }
    } else {
      const [b, s, precipMm, wind] = await Promise.all([
        getHrdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getHrdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
        getHrdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getHrdpsWind10m(summitPoint.lat, summitPoint.lon, time),
      ]);
      if (b != null || s != null) hrdps.push(period(h, labelForLead(h), b, s, "HRDPS", precipMm, wind));
    }
  }

  // RDPS 10 km: query base and summit grid cells separately; use 2m temps directly (no lapse).
  // Wind: prefer 80 m at summit (ridge-level); fall back to 10 m at base if 80 m unavailable.
  const rdps: ForecastPeriod[] = [];
  for (const h of rdpsLeads) {
    const time = validTimeIso(ref, h);
    const [rdpsBase, rdpsSummit, rdpsPrecip, wind80m, wind10m] = await Promise.all([
      getRdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
      getRdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsWind80m(summitPoint.lat, summitPoint.lon, time),
      getRdpsWind10m(COORDS.BASE.lat, COORDS.BASE.lon, time),
    ]);
    const wind = wind80m ?? wind10m;
    if (rdpsBase != null || rdpsSummit != null) {
      rdps.push(period(h, labelForLead(h), rdpsBase ?? null, rdpsSummit ?? null, "RDPS", rdpsPrecip, wind));
    }
  }

  // 7-day table: RDPS and GDPS for leads 24, 48, 72, 96, 120, 144, 168 h (same layout as HRDPS/RDPS table).
  // RDPS and GDPS run 00/12 UTC only; use rdpsRef/gdpsRef so GetCapabilities times match.
  const rdpsRef = getRdpsReferenceTimeUtc();
  const gdpsRef = getGdpsReferenceTimeUtc();
  const [rdps7dLeads, gdps7dLeads] = await Promise.all([
    getAvailableLeadsInSet(rdpsRef, COVERAGE_IDS.RDPS_2M_TEMP, SEVEN_DAY_LEADS),
    getAvailableLeadsInSet(gdpsRef, COVERAGE_IDS.GDPS_2M_TEMP_15KM, SEVEN_DAY_LEADS),
  ]);

  const rdps7d: ForecastPeriod[] = [];
  for (const h of rdps7dLeads) {
    const time = validTimeIso(rdpsRef, h);
    const [rdpsBase, rdpsSummit, rdpsPrecip, wind80m, wind10m] = await Promise.all([
      getRdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
      getRdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsWind80m(summitPoint.lat, summitPoint.lon, time),
      getRdpsWind10m(COORDS.BASE.lat, COORDS.BASE.lon, time),
    ]);
    const wind = wind80m ?? wind10m;
    if (rdpsBase != null || rdpsSummit != null) {
      rdps7d.push(period(h, labelForLead(h), rdpsBase ?? null, rdpsSummit ?? null, "RDPS", rdpsPrecip, wind));
    }
  }

  const gdps7d: ForecastPeriod[] = [];
  for (const h of gdps7dLeads) {
    const time = validTimeIso(gdpsRef, h);
    const [s, precipMm, wind] = await Promise.all([
      getGdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
      getGdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getGdpsWind10m(summitPoint.lat, summitPoint.lon, time),
    ]);
    const b = s != null ? lapseCorrectBase(s, COORDS.PARADISE.elevM, COORDS.BASE.elevM) : null;
    if (b != null || s != null) {
      gdps7d.push(period(h, labelForLead(h), b, s, "GDPS", precipMm, wind));
    }
  }

  // 7-day daily low/high: fetch mid + end of each 24h window (12, 24, 36, …, 168), then aggregate.
  const [rdpsDetailLeads, gdpsDetailLeads] = await Promise.all([
    getAvailableLeadsInSet(rdpsRef, COVERAGE_IDS.RDPS_2M_TEMP, SEVEN_DAY_LEADS_DETAILED),
    getAvailableLeadsInSet(gdpsRef, COVERAGE_IDS.GDPS_2M_TEMP_15KM, SEVEN_DAY_LEADS_DETAILED),
  ]);

  const rdpsDetail: ForecastPeriod[] = [];
  for (const h of rdpsDetailLeads) {
    const time = validTimeIso(rdpsRef, h);
    const [rdpsBase, rdpsSummit, rdpsPrecip, wind80m, wind10m] = await Promise.all([
      getRdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
      getRdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsWind80m(summitPoint.lat, summitPoint.lon, time),
      getRdpsWind10m(COORDS.BASE.lat, COORDS.BASE.lon, time),
    ]);
    const wind = wind80m ?? wind10m;
    if (rdpsBase != null || rdpsSummit != null) {
      rdpsDetail.push(period(h, labelForLead(h), rdpsBase ?? null, rdpsSummit ?? null, "RDPS", rdpsPrecip, wind));
    }
  }

  const gdpsDetail: ForecastPeriod[] = [];
  for (const h of gdpsDetailLeads) {
    const time = validTimeIso(gdpsRef, h);
    const [s, precipMm, wind] = await Promise.all([
      getGdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
      getGdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getGdpsWind10m(summitPoint.lat, summitPoint.lon, time),
    ]);
    const b = s != null ? lapseCorrectBase(s, COORDS.PARADISE.elevM, COORDS.BASE.elevM) : null;
    if (b != null || s != null) {
      gdpsDetail.push(period(h, labelForLead(h), b, s, "GDPS", precipMm, wind));
    }
  }

  /** Build 7 ForecastDay from detailed periods: each day = (endLead - 12, endLead), min/max base & summit. */
  function buildDays(periods: ForecastPeriod[], endLeads: number[]): ForecastDay[] {
    const byLead = new Map(periods.map((p) => [p.leadHours, p]));
    const days: ForecastDay[] = [];
    for (const endLead of endLeads) {
      const startLead = endLead - 12;
      const pStart = byLead.get(startLead);
      const pEnd = byLead.get(endLead);
      const baseTemps = [pStart?.tempBase, pEnd?.tempBase].filter((t): t is number => t != null && Number.isFinite(t));
      const summitTemps = [pStart?.tempSummit, pEnd?.tempSummit].filter((t): t is number => t != null && Number.isFinite(t));
      const tempBaseLow = baseTemps.length > 0 ? Math.min(...baseTemps) : null;
      const tempBaseHigh = baseTemps.length > 0 ? Math.max(...baseTemps) : null;
      const tempSummitLow = summitTemps.length > 0 ? Math.min(...summitTemps) : null;
      const tempSummitHigh = summitTemps.length > 0 ? Math.max(...summitTemps) : null;
      const p = pEnd ?? pStart;
      days.push({
        leadHours: endLead,
        label: labelForLead(endLead),
        tempBaseLow,
        tempBaseHigh,
        tempSummitLow,
        tempSummitHigh,
        windSpeed: p?.windSpeed ?? null,
        windDir: p?.windDir ?? null,
        source: periods[0]?.source ?? "?",
        precipMm: p?.precipMm ?? null,
      });
    }
    return days;
  }

  let rdps7dDays = buildDays(rdpsDetail, SEVEN_DAY_LEADS);
  let gdps7dDays = buildDays(gdpsDetail, SEVEN_DAY_LEADS);

  // When detailed timesteps (12, 24, 36, …) weren't available, fill low/high from snapshot (rdps7d/gdps7d) so we show "X° / X°".
  const rdps7dByLead = new Map(rdps7d.map((p) => [p.leadHours, p]));
  const gdps7dByLead = new Map(gdps7d.map((p) => [p.leadHours, p]));
  rdps7dDays = rdps7dDays.map((d) => {
    if (
      d.tempBaseLow != null ||
      d.tempBaseHigh != null ||
      d.tempSummitLow != null ||
      d.tempSummitHigh != null
    )
      return d;
    const snap = rdps7dByLead.get(d.leadHours);
    if (!snap) return d;
    return {
      ...d,
      tempBaseLow: snap.tempBase ?? null,
      tempBaseHigh: snap.tempBase ?? null,
      tempSummitLow: snap.tempSummit ?? null,
      tempSummitHigh: snap.tempSummit ?? null,
      precipMm: snap.precipMm ?? d.precipMm,
      windSpeed: snap.windSpeed ?? d.windSpeed,
      windDir: snap.windDir ?? d.windDir,
    };
  });
  gdps7dDays = gdps7dDays.map((d) => {
    if (
      d.tempBaseLow != null ||
      d.tempBaseHigh != null ||
      d.tempSummitLow != null ||
      d.tempSummitHigh != null
    )
      return d;
    const snap = gdps7dByLead.get(d.leadHours);
    if (!snap) return d;
    return {
      ...d,
      tempBaseLow: snap.tempBase ?? null,
      tempBaseHigh: snap.tempBase ?? null,
      tempSummitLow: snap.tempSummit ?? null,
      tempSummitHigh: snap.tempSummit ?? null,
      precipMm: snap.precipMm ?? d.precipMm,
      windSpeed: snap.windSpeed ?? d.windSpeed,
      windDir: snap.windDir ?? d.windDir,
    };
  });

  return {
    hrdps,
    rdps,
    rdps7d,
    gdps7d,
    rdps7dDays,
    gdps7dDays,
    gdpsTrend:
      gdpsBase != null || gdpsSummit != null
        ? "Long-range (7-day) trend: GeoMet GDPS point data available."
        : "Long-range trend: Data unavailable.",
    verticalProfile: [],
    pm25: null,
  };
}
