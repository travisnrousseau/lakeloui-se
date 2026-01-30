/**
 * Canadian model forecast via GeoMet WCS (point requests).
 * Returns ForecastPeriod[] and DetailedForecast for drop-in use with render.
 * GeoMet returns latest run; we fill 6–48h using one HRDPS value (6–24h) and one GDPS value (36–48h).
 */

import type { ForecastPeriod, DetailedForecast } from "./mscModels.js";
import {
  getCapabilities,
  getHrdpsTemp2m,
  getHrdpsPrecipMm,
  getHrdpsWind10m,
  getRdpsTemp2m,
  getRdpsPrecipMm,
  getRdpsPblHeightM,
  getRdpsWind10m,
  getGdpsTemp2m,
  COORDS,
  COVERAGE_IDS,
} from "./geometClient.js";
import { getSummitPointForTemp } from "./elevation.js";

/** Table leads: 0h–48h; HRDPS 0–24h, GDPS 36–48h. Render uses whatever leads are present in data. */
export const FORECAST_LEADS = [0, 3, 6, 12, 18, 24, 36, 48];
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

/** HRDPS runs at 00, 06, 12, 18 UTC. Return latest run time (UTC) at or before now. */
function getHrdpsReferenceTimeUtc(): Date {
  const now = new Date();
  const hour = now.getUTCHours();
  const runHour = Math.floor(hour / 6) * 6; // 0, 6, 12, 18
  const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), runHour, 0, 0, 0));
  if (ref.getTime() > now.getTime()) ref.setUTCHours(ref.getUTCHours() - 6);
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
    if (useGdps) {
      s = await getGdpsTemp2m(summitPoint.lat, summitPoint.lon, time);
      b = s != null ? lapseCorrectBase(s, COORDS.PARADISE.elevM, COORDS.BASE.elevM) : null;
    } else {
      [b, s, precipMm] = await Promise.all([
        getHrdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
        getHrdpsTemp2m(summitPoint.lat, summitPoint.lon, time),
        getHrdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      ]);
    }
    const source = useGdps ? "GDPS" : "HRDPS";
    if (b != null || s != null) timeline.push(period(h, labelForLead(h), b, s, source, precipMm));
  }
  return timeline;
}

/**
 * Detailed forecast from GeoMet: HRDPS row 0–24h, RDPS row (lapse from 2071 m) per lead, GDPS 36–48h.
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
      const s = await getGdpsTemp2m(summitPoint.lat, summitPoint.lon, time);
      const b = s != null ? lapseCorrectBase(s, COORDS.PARADISE.elevM, COORDS.BASE.elevM) : null;
      if (b != null || s != null) {
        hrdps.push(period(h, labelForLead(h), b, s, "GDPS", null));
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

  const rdps: ForecastPeriod[] = [];
  for (const h of rdpsLeads) {
    const time = validTimeIso(ref, h);
    const [rdpsAtRef, rdpsPblHeight, rdpsPrecip, wind] = await Promise.all([
      getRdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsPblHeightM(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsPrecipMm(COORDS.BASE.lat, COORDS.BASE.lon, time),
      getRdpsWind10m(COORDS.BASE.lat, COORDS.BASE.lon, time),
    ]);
    const corrected =
      rdpsAtRef != null
        ? lapseCorrectFromRefWithPbl(
            rdpsAtRef,
            RDPS_REF_ELEV_M,
            COORDS.BASE.elevM,
            COORDS.PARADISE.elevM,
            rdpsPblHeight
          )
        : null;
    if (corrected != null) {
      rdps.push(period(h, labelForLead(h), corrected.baseTemp, corrected.summitTemp, "RDPS", rdpsPrecip, wind));
    }
  }

  return {
    hrdps,
    rdps,
    gdpsTrend:
      gdpsBase != null || gdpsSummit != null
        ? "Long-range (7-day) trend: GeoMet GDPS point data available."
        : "Long-range trend: Data unavailable.",
    verticalProfile: [],
    pm25: null,
  };
}
