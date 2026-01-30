/**
 * Pika Run & Skoki (GOES-18) station fetcher.
 *
 * Data source: Alberta River Basins (rivers.alberta.ca) — JSON table endpoints
 * for PC (precipitation) at 15-min interval. GOES-18 DCP → ACIS → Alberta.
 * See docs/DATA_SOURCES.md §2 (High-Alpine Monitoring).
 */

const PIKA_JSON_URL = "https://rivers.alberta.ca/apps/Basins/data/figures/river/abrivers/stationdata/M_PC_05BA815_table.json";
const SKOKI_JSON_URL = "https://rivers.alberta.ca/apps/Basins/data/figures/river/abrivers/stationdata/M_PC_05CA805_table.json";

/** One row from rivers.alberta.ca table JSON: [timestamp, value] */
type TableRow = [string, number];

interface RiversAlbertaTableResponse {
  station_no?: string;
  station_name?: string;
  stationparameter_name?: string;
  columns?: string;
  data?: TableRow[];
  ts_unitsymbols?: string[];
  ts_median_interval?: string;
  rows?: string;
}

function parseTableJson(body: string): TableRow[] | null {
  let arr: unknown;
  try {
    arr = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0] as RiversAlbertaTableResponse;
  if (!first?.data || !Array.isArray(first.data)) return null;
  return first.data;
}

const MS_12H = 12 * 60 * 60 * 1000;
const MS_24H = 24 * 60 * 60 * 1000;
const MS_48H = 48 * 60 * 60 * 1000;
const MS_7D = 7 * 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD HH:mm:ss" to ms (UTC); safe for delta math. */
function parseTimestamp(ts: string): number | null {
  const ms = Date.parse(ts.replace(" ", "T") + "Z");
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Sum precipitation (mm) over rolling windows from table data.
 * data is [timestamp, value][] ascending; uses last row time as "now".
 */
function sumPrecipWindows(data: TableRow[]): {
  timestamp: string;
  precipMm: number;
  precip12hMm: number;
  precip24hMm: number;
  precip48hMm: number;
  precip7dMm: number;
} | null {
  if (!data.length) return null;
  const last = data[data.length - 1];
  const [tsEnd, lastVal] = last;
  if (typeof tsEnd !== "string" || typeof lastVal !== "number") return null;
  const endMs = parseTimestamp(tsEnd);
  if (endMs == null) return null;
  let sum12 = 0,
    sum24 = 0,
    sum48 = 0,
    sum7d = 0;
  for (const [ts, val] of data) {
    if (typeof ts !== "string" || typeof val !== "number") continue;
    const rowMs = parseTimestamp(ts);
    if (rowMs == null) continue;
    const delta = endMs - rowMs;
    if (delta <= MS_7D) sum7d += val;
    if (delta <= MS_48H) sum48 += val;
    if (delta <= MS_24H) sum24 += val;
    if (delta <= MS_12H) sum12 += val;
  }
  return {
    timestamp: tsEnd,
    precipMm: lastVal,
    precip12hMm: Math.round(sum12 * 10) / 10,
    precip24hMm: Math.round(sum24 * 10) / 10,
    precip48hMm: Math.round(sum48 * 10) / 10,
    precip7dMm: Math.round(sum7d * 10) / 10
  };
}

/**
 * Fetch precipitation and 12h/24h/48h/7d sums from a rivers.alberta.ca table JSON.
 */
async function fetchPrecipWithWindows(url: string): Promise<ReturnType<typeof sumPrecipWindows>> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.text();
  const data = parseTableJson(body);
  return data ? sumPrecipWindows(data) : null;
}

export interface PikaStationData {
  name: string;
  timestamp: string;
  tempC?: number;
  precipMm?: number;
  /** Precip sum last 12 h (mm) */
  precip12hMm?: number;
  precip24hMm?: number;
  precip48hMm?: number;
  precip7dMm?: number;
  snowDepthCm?: number;
  windSpeedKmh?: number;
  windDirDeg?: number;
  rh?: number;
}

export interface SkokiStationData {
  name: string;
  timestamp: string;
  sweMm?: number;
  snowDepthCm?: number;
  tempC?: number;
  precipMm?: number;
  precip12hMm?: number;
  precip24hMm?: number;
  precip48hMm?: number;
  precip7dMm?: number;
}

/**
 * Fetch Pika Run (mid-mountain) precipitation from Alberta River Basins.
 * Station 05BA815 "Pika Run - EPA"; parameter PC (mm), 15-min interval.
 * Includes 12h, 24h, 48h, 7d sums.
 */
export async function fetchPika(): Promise<PikaStationData | null> {
  const w = await fetchPrecipWithWindows(PIKA_JSON_URL);
  if (!w) return null;
  return {
    name: "Pika Run",
    timestamp: w.timestamp,
    precipMm: w.precipMm,
    precip12hMm: w.precip12hMm,
    precip24hMm: w.precip24hMm,
    precip48hMm: w.precip48hMm,
    precip7dMm: w.precip7dMm
  };
}

/**
 * Fetch Skoki (snow pillow) precipitation from Alberta River Basins.
 * Station 05CA805 "Skoki Lodge - EPA"; parameter PC (mm), 15-min interval.
 * Includes 12h, 24h, 48h, 7d sums.
 */
export async function fetchSkoki(): Promise<SkokiStationData | null> {
  const w = await fetchPrecipWithWindows(SKOKI_JSON_URL);
  if (!w) return null;
  return {
    name: "Skoki",
    timestamp: w.timestamp,
    precipMm: w.precipMm,
    precip12hMm: w.precip12hMm,
    precip24hMm: w.precip24hMm,
    precip48hMm: w.precip48hMm,
    precip7dMm: w.precip7dMm
  };
}
