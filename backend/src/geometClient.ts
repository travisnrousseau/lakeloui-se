/**
 * GeoMet client for Canadian models (HRDPS, RDPS, GDPS).
 * Prefer WMS GetFeatureInfo (same layer names as WCS); fall back to WCS GetCoverage + netCDF.
 * See docs/GEOMET_STRATEGY.md and docs/MODEL_AVAILABILITY.md.
 */

import { NetCDFReader } from "netcdfjs";
import { XMLParser } from "fast-xml-parser";

const GEOMET_BASE = "https://geo.weather.gc.ca/geomet";

/**
 * WMS GetCapabilities: fetch XML and parse available time dimension for a layer.
 * GeoMet supports optional layer=LAYER_NAME to return a smaller document.
 * Returns array of ISO8601 time strings (e.g. 2026-01-29T18:00:00Z); empty if layer missing or no time dimension.
 */
export async function getCapabilities(layerName: string): Promise<string[]> {
  const url = new URL(GEOMET_BASE);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetCapabilities");
  url.searchParams.set("layer", layerName);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: true
    });
    const doc = parser.parse(xml) as {
      WMS_Capabilities?: { Capability?: { Layer?: unknown } };
      WMT_MS_Capabilities?: { Capability?: { Layer?: unknown } };
    };
    const cap = doc?.WMS_Capabilities?.Capability ?? doc?.WMT_MS_Capabilities?.Capability;
    if (!cap) return [];
    const layers = cap.Layer;
    if (!layers) return [];
    const layerList = Array.isArray(layers) ? layers : [layers];
    const layer = layerList.find(
      (l: Record<string, unknown>) => (l["@_name"] ?? l.Name) === layerName
    ) as Record<string, unknown> | undefined;
    if (!layer) return [];
    const dim = layer.Dimension ?? layer.Extent;
    if (!dim) return [];
    const dimList = Array.isArray(dim) ? dim : [dim];
    const timeDim = dimList.find(
      (d: Record<string, unknown>) => (d["@_name"] ?? d["@_identifier"]) === "time"
    ) as Record<string, unknown> | undefined;
    if (!timeDim) {
      const raw = (layer.Dimension ?? layer.Extent) as Record<string, unknown> | undefined;
      const rawVal = raw && !Array.isArray(raw) ? (raw["#text"] ?? raw["Value"]) : undefined;
      if (typeof rawVal === "string") return parseTimeDimensionValue(rawVal);
      return [];
    }
    const value = timeDim["#text"] ?? timeDim["Value"] ?? timeDim["@_value"];
    if (typeof value !== "string") return [];
    return parseTimeDimensionValue(value);
  } catch (e) {
    if (process.env.DEBUG_GEOMET) {
      console.warn("GeoMet getCapabilities error:", e);
    }
    return [];
  }
}

/** Parse WMS time dimension value: comma-separated list or start/end/period (e.g. P3H). Returns ISO8601 strings. */
function parseTimeDimensionValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.includes(",")) {
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const rangeMatch = trimmed.match(/^([^/]+)\/([^/]+)\/(.+)$/);
  if (rangeMatch) {
    const [, start, end, period] = rangeMatch;
    const list: string[] = [];
    const startMs = new Date(start!.trim()).getTime();
    const endMs = new Date(end!.trim()).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) return [];
    const periodMs = parsePeriod(period!.trim());
    if (periodMs <= 0) return [];
    for (let t = startMs; t <= endMs; t += periodMs) {
      list.push(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
    }
    return list;
  }
  return [trimmed];
}

/** Parse ISO8601 duration e.g. PT3H, P1D. Returns milliseconds or 0. */
function parsePeriod(period: string): number {
  const m = period.match(/^P(?:T)?(\d+)([HMD])?$/i) ?? period.match(/^PT(\d+)M$/i);
  if (!m) return 0;
  const n = parseInt(m[1]!, 10);
  const unit = (m[2] ?? "H").toUpperCase();
  if (unit === "H") return n * 60 * 60 * 1000;
  if (unit === "M") return n * 60 * 1000;
  if (unit === "D") return n * 24 * 60 * 60 * 1000;
  return 0;
}

/** WMS GetFeatureInfo: bbox (Lake Louise area). EPSG:4326 in 1.3.0 = min_lat, min_lon, max_lat, max_lon. */
const WMS_BBOX_MIN_LAT = 51;
const WMS_BBOX_MAX_LAT = 52;
const WMS_BBOX_MIN_LON = -117;
const WMS_BBOX_MAX_LON = -116;
const WMS_BBOX_STR = `${WMS_BBOX_MIN_LAT},${WMS_BBOX_MIN_LON},${WMS_BBOX_MAX_LAT},${WMS_BBOX_MAX_LON}`;
const WMS_SIZE = 100;

/** Pixel (I,J) from lat,lon: I = x (lon), J = y (lat); J=0 = max_lat. */
function wmsPixelFromLatLon(lat: number, lon: number): { i: number; j: number } {
  const i = Math.round(
    ((lon - WMS_BBOX_MIN_LON) / (WMS_BBOX_MAX_LON - WMS_BBOX_MIN_LON)) * (WMS_SIZE - 1)
  );
  const j = Math.round(
    ((WMS_BBOX_MAX_LAT - lat) / (WMS_BBOX_MAX_LAT - WMS_BBOX_MIN_LAT)) * (WMS_SIZE - 1)
  );
  return {
    i: Math.max(0, Math.min(WMS_SIZE - 1, i)),
    j: Math.max(0, Math.min(WMS_SIZE - 1, j)),
  };
}

/** Lake Louise coordinates. */
export const COORDS = {
  BASE: { lat: 51.443204, lon: -116.161562, elevM: 1650 },
  PARADISE: { lat: 51.460321, lon: -116.131901, elevM: 2630 },
} as const;

/** Coverage/layer IDs from GeoMet (WCS 2.0.1 / WMS). RDPS uses WMS layer RDPS.ETA_TT. */
export const COVERAGE_IDS = {
  HRDPS_2M_TEMP: "HRDPS-WEonG_2.5km_AirTemp",
  HRDPS_PRECIP: "HRDPS-WEonG_2.5km_TotalPrecipitation",
  /** Fallback: doc says HRDPS.CONTINENTAL_APCP; WCS-style name may not be in WMS in some regions. */
  HRDPS_PRECIP_ALT: "HRDPS.CONTINENTAL_APCP",
  HRDPS_WIND_SPEED: "HRDPS-WEonG_2.5km_WindSpeed",
  HRDPS_WIND_DIR: "HRDPS-WEonG_2.5km_WindDir",
  RDPS_2M_TEMP: "RDPS.ETA_TT",
  RDPS_PRECIP: "RDPS.ETA_PR",
  RDPS_PBL_HEIGHT: "RDPS_10km_PlanetaryBoundaryLayerHeight",
  RDPS_WIND_SPEED: "RDPS_10km_WindSpeed_10m",
  RDPS_WIND_DIR: "RDPS_10km_WindDir_10m",
  RDPS_WIND_SPEED_80M: "RDPS_10km_WindSpeed_80m",
  RDPS_WIND_DIR_80M: "RDPS_10km_WindDir_80m",
  GDPS_2M_TEMP_15KM: "GDPS_15km_AirTemp_2m",
  GDPS_2M_TEMP_25KM: "GDPS-GEML_25km_AirTemp_2m",
  /** 3h accumulation (mm liquid) at valid time; no TotalPrecipitation layer in GeoMet for 15km. */
  GDPS_PRECIP: "GDPS_15km_Precip-Accum3h",
  /** Single combined layer; GetFeatureInfo may return speed (and dir in another band). */
  GDPS_WINDS_10M: "GDPS_15km_Winds_10m",
} as const;

/** Half-width in degrees for point subset (small bbox around lat/lon). */
const SUBSET_DELTA = 0.05;

/**
 * WMS 1.3.0 GetFeatureInfo: layer name = WCS coverage ID (e.g. HRDPS-WEonG_2.5km_AirTemp).
 * I,J computed from (lat, lon) so base and summit get correct altitude temps.
 * time: optional ISO8601 valid time (e.g. 2026-01-30T18:00:00Z) for forecast hour; omit for default/latest.
 * Returns numeric value from JSON (e.g. features[0].properties.value) or null.
 */
async function fetchWmsPointValue(
  layerName: string,
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const { i, j } = wmsPixelFromLatLon(lat, lon);
  const url = new URL(GEOMET_BASE);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetFeatureInfo");
  url.searchParams.set("LAYERS", layerName);
  url.searchParams.set("QUERY_LAYERS", layerName);
  url.searchParams.set("BBOX", WMS_BBOX_STR);
  if (time) url.searchParams.set("TIME", time);
  url.searchParams.set("FEATURE_COUNT", "1");
  url.searchParams.set("I", String(i));
  url.searchParams.set("J", String(j));
  url.searchParams.set("WIDTH", String(WMS_SIZE));
  url.searchParams.set("HEIGHT", String(WMS_SIZE));
  url.searchParams.set("INFO_FORMAT", "application/json");
  url.searchParams.set("CRS", "EPSG:4326");
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const features = data?.features as Array<{ properties?: Record<string, unknown> }> | undefined;
    let val = features?.[0]?.properties?.value ?? (data as { value?: number }).value;
    if (typeof val === "number" && Number.isFinite(val)) return val;
    // GeoMet/MapServer may return precip (and other bands) under different keys (e.g. GRAY_INDEX, Band1, Amount)
    const props = features?.[0]?.properties;
    if (props && typeof props === "object") {
      for (const v of Object.values(props)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          val = v;
          break;
        }
      }
    }
    if (typeof val === "number" && Number.isFinite(val)) return val;
    return null;
  } catch (e) {
    if (process.env.DEBUG_GEOMET) {
      console.warn("GeoMet WMS GetFeatureInfo error:", e);
    }
    return null;
  }
}

/**
 * WMS GetFeatureInfo returning all numeric property values (for multi-band layers e.g. GDPS Winds_10m).
 * Order may be band1, band2 or key order; caller uses first as speed, second as dir if present.
 */
async function fetchWmsPointValues(
  layerName: string,
  lat: number,
  lon: number,
  time?: string
): Promise<number[]> {
  const { i, j } = wmsPixelFromLatLon(lat, lon);
  const url = new URL(GEOMET_BASE);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetFeatureInfo");
  url.searchParams.set("LAYERS", layerName);
  url.searchParams.set("QUERY_LAYERS", layerName);
  url.searchParams.set("BBOX", WMS_BBOX_STR);
  if (time) url.searchParams.set("TIME", time);
  url.searchParams.set("FEATURE_COUNT", "1");
  url.searchParams.set("I", String(i));
  url.searchParams.set("J", String(j));
  url.searchParams.set("WIDTH", String(WMS_SIZE));
  url.searchParams.set("HEIGHT", String(WMS_SIZE));
  url.searchParams.set("INFO_FORMAT", "application/json");
  url.searchParams.set("CRS", "EPSG:4326");
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return [];
    const data = (await res.json()) as Record<string, unknown>;
    const features = data?.features as Array<{ properties?: Record<string, unknown> }> | undefined;
    const props = features?.[0]?.properties;
    if (!props || typeof props !== "object") return [];
    const values: number[] = [];
    for (const v of Object.values(props)) {
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    return values;
  } catch (e) {
    if (process.env.DEBUG_GEOMET) {
      console.warn("GeoMet WMS GetFeatureInfo (multi) error:", e);
    }
    return [];
  }
}

/**
 * Build WCS 2.0.1 GetCoverage URL for a point (small bbox).
 * Axis labels from DescribeCoverage: long, lat.
 */
function getCoverageUrl(
  coverageId: string,
  lat: number,
  lon: number,
  format: string = "image/netcdf"
): string {
  const lonMin = lon - SUBSET_DELTA;
  const lonMax = lon + SUBSET_DELTA;
  const latMin = lat - SUBSET_DELTA;
  const latMax = lat + SUBSET_DELTA;
  const url = new URL(GEOMET_BASE);
  url.searchParams.set("SERVICE", "WCS");
  url.searchParams.set("VERSION", "2.0.1");
  url.searchParams.set("REQUEST", "GetCoverage");
  url.searchParams.set("COVERAGEID", coverageId);
  url.searchParams.set("FORMAT", format);
  url.searchParams.set("SUBSET", `Long(${lonMin},${lonMax})`);
  url.searchParams.append("SUBSET", `Lat(${latMin},${latMax})`);
  return url.toString();
}

/**
 * Fetch GetCoverage response (netCDF binary).
 */
export async function fetchCoveragePoint(
  coverageId: string,
  lat: number,
  lon: number
): Promise<ArrayBuffer | null> {
  const url = getCoverageUrl(coverageId, lat, lon);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch (e) {
    if (process.env.DEBUG_GEOMET) {
      console.warn("GeoMet fetchCoveragePoint error:", e);
    }
    return null;
  }
}

/** Coordinate/dimension variable names to skip when picking the data band. */
const COORD_VAR_NAMES = new Set(["lat", "lon", "long", "x", "y", "time", "latitude", "longitude"]);

/**
 * Parse netCDF buffer and return a single scalar (center value of the data band).
 * GeoMet netCDF has "band" or similar; skip lat/lon so we don't return coordinates as temps.
 * NetCDFReader (netcdfjs) supports NetCDF v3; if server returns NetCDF4, this will throw.
 */
export function parseNetCDFPoint(buffer: ArrayBuffer): number | null {
  try {
    const reader = new NetCDFReader(buffer);
    const vars = reader.variables;
    if (!vars || vars.length === 0) return null;
    // Prefer "band"; skip coordinate variables (lat, lon, etc.)
    interface VarLike { name: string; dimensions: number[] }
    const dataVars = (vars as VarLike[]).filter(
      (v) =>
        v.dimensions &&
        v.dimensions.length > 0 &&
        !COORD_VAR_NAMES.has(v.name.toLowerCase())
    );
    if (dataVars.length === 0) {
      if (process.env.DEBUG_GEOMET) {
        console.warn("GeoMet netCDF: no data variables (only:", (vars as VarLike[]).map((v) => v.name).join(", "), ")");
      }
      return null;
    }
    const preferNames = ["band", "band1", "z", "airtemp", "values"];
    const bandVar =
      dataVars.find((v) => preferNames.includes(v.name.toLowerCase())) ??
      dataVars[0];
    const order = bandVar ? [bandVar, ...dataVars.filter((v) => v !== bandVar)] : dataVars;
    for (const v of order) {
      const data = reader.getDataVariable(v.name);
      if (data == null) continue;
      const arr = Array.isArray(data) ? data : [data];
      const nums = arr.filter(
        (x): x is number => typeof x === "number" && Number.isFinite(x)
      );
      if (nums.length === 0) continue;
      const fillVal = reader.getAttribute("_FillValue") ?? reader.getAttribute("missing_value");
      const exclude = (n: number) =>
        (n >= 50 && n <= 53) ||
        (fillVal != null && typeof fillVal === "number" && Math.abs(n - fillVal) < 1e-6);
      const valid = nums.filter((n) => !exclude(n));
      const idx = Math.floor(nums.length / 2);
      const center = nums[idx];
      const mean = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : center;
      const val = !exclude(center) && Math.abs(center) < 1e10 ? center : (valid.length > 0 && Math.abs(mean) < 1e10 ? mean : null);
      if (val != null) return val;
    }
    return null;
  } catch (e) {
    if (process.env.DEBUG_GEOMET) {
      console.warn("GeoMet parseNetCDF error:", e);
    }
    return null;
  }
}

/**
 * Get a single point value from GeoMet: try WMS GetFeatureInfo first (avoids 404s with WCS-style layer names), then WCS + netCDF.
 * time: optional ISO8601 valid time for forecast hour (WMS only; WCS fallback uses default).
 * Returns temperature in °C if the coverage is AirTemp; otherwise raw value.
 * Returns null on fetch/parse error.
 */
export async function getPointValue(
  coverageId: string,
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const wmsVal = await fetchWmsPointValue(coverageId, lat, lon, time);
  if (wmsVal != null) return wmsVal;
  const buf = await fetchCoveragePoint(coverageId, lat, lon);
  if (!buf || buf.byteLength === 0) return null;
  const val = parseNetCDFPoint(buf);
  return val;
}

/**
 * Fetch HRDPS 2 m temperature at a point (°C).
 * time: optional ISO8601 valid time for forecast hour (e.g. 2026-01-30T18:00:00Z).
 * Coverage HRDPS-WEonG_2.5km_AirTemp: value may be in Kelvin or °C; treat as °C if in plausible range, else assume K.
 */
export async function getHrdpsTemp2m(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const val = await getPointValue(COVERAGE_IDS.HRDPS_2M_TEMP, lat, lon, time);
  if (val == null) return null;
  // GeoMet may return K (273–303) or °C (-20–30)
  if (val > 200) return val - 273.15;
  return val;
}

/**
 * Fetch RDPS 2 m temperature at a point (°C). Layer RDPS.ETA_TT; value at ~2071 m reference elevation.
 * time: optional ISO8601 valid time for forecast hour.
 */
export async function getRdpsTemp2m(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const val = await getPointValue(COVERAGE_IDS.RDPS_2M_TEMP, lat, lon, time);
  if (val == null) return null;
  if (val > 200) return val - 273.15;
  return val;
}

/**
 * Fetch RDPS planetary boundary layer height at a point (m). Layer RDPS_10km_PlanetaryBoundaryLayerHeight.
 * time: optional ISO8601 valid time for forecast hour.
 * Returns null if fetch fails or value is out of plausible range (0–5000 m).
 */
export async function getRdpsPblHeightM(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const val = await getPointValue(COVERAGE_IDS.RDPS_PBL_HEIGHT, lat, lon, time);
  if (val == null || !Number.isFinite(val)) return null;
  if (val < 0 || val > 5000) return null;
  return val;
}

/**
 * Fetch GDPS 2 m temperature at a point (°C).
 * time: optional ISO8601 valid time for forecast hour.
 */
export async function getGdpsTemp2m(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  let val = await getPointValue(COVERAGE_IDS.GDPS_2M_TEMP_15KM, lat, lon, time);
  if (val == null)
    val = await getPointValue(COVERAGE_IDS.GDPS_2M_TEMP_25KM, lat, lon, time);
  if (val == null) return null;
  if (val > 200) return val - 273.15;
  return val;
}

/**
 * Fetch GDPS precipitation at a point (mm liquid). Layer GDPS_15km_Precip-Accum3h (3h accumulation).
 * time: optional ISO8601 valid time for forecast hour.
 */
export async function getGdpsPrecipMm(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const val = await getPointValue(COVERAGE_IDS.GDPS_PRECIP, lat, lon, time);
  if (val == null || !Number.isFinite(val) || val < 0) return null;
  return val;
}

/**
 * Fetch GDPS 10 m wind at a point (speed km/h, direction degrees 0–360, meteorological "from").
 * GDPS GRIB2 exposes wind as U and V components (m/s). GeoMet GDPS_15km_Winds_10m returns two bands;
 * we treat them as U (eastward), V (northward) in m/s and compute speed and "from" direction.
 * Returns null if we don't have two valid U,V values (no fallback to wrong band interpretation).
 * time: optional ISO8601 valid time for forecast hour.
 */
export async function getGdpsWind10m(
  lat: number,
  lon: number,
  time?: string
): Promise<{ speedKmh: number; dirDeg: number } | null> {
  const values = await fetchWmsPointValues(COVERAGE_IDS.GDPS_WINDS_10M, lat, lon, time);
  const u = values[0];
  const v = values[1];
  if (u == null || !Number.isFinite(u) || v == null || !Number.isFinite(v)) return null;
  // ECCC GDPS wind is U,V components (m/s). Plausible range ±150 m/s.
  if (Math.abs(u) > 150 || Math.abs(v) > 150) return null;
  const speedMs = Math.sqrt(u * u + v * v);
  const speedKmh = speedMs * 3.6;
  if (speedKmh <= 0) return null;
  // Meteorological "from" direction (degrees): 180 + atan2(U, V); 0 = N, 90 = E, 270 = W.
  const dirDeg = ((180 + (Math.atan2(u, v) * 180) / Math.PI) + 360) % 360;
  return { speedKmh, dirDeg };
}

/**
 * Fetch HRDPS precipitation at a point (mm liquid). Tries HRDPS-WEonG_2.5km_TotalPrecipitation first,
 * then HRDPS.CONTINENTAL_APCP (doc fallback; WCS-style name may not be in WMS in some deployments).
 * time: optional ISO8601 valid time for forecast hour.
 * Returns null if both layers unavailable or fetch fails.
 */
export async function getHrdpsPrecipMm(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  let val = await getPointValue(COVERAGE_IDS.HRDPS_PRECIP, lat, lon, time);
  if ((val == null || !Number.isFinite(val) || val < 0) && COVERAGE_IDS.HRDPS_PRECIP_ALT) {
    val = await getPointValue(COVERAGE_IDS.HRDPS_PRECIP_ALT, lat, lon, time);
  }
  if (val == null || !Number.isFinite(val) || val < 0) return null;
  return val;
}

/**
 * Fetch RDPS precipitation at a point (mm liquid). Layer RDPS.ETA_PR.
 * time: optional ISO8601 valid time for forecast hour.
 */
export async function getRdpsPrecipMm(
  lat: number,
  lon: number,
  time?: string
): Promise<number | null> {
  const val = await getPointValue(COVERAGE_IDS.RDPS_PRECIP, lat, lon, time);
  if (val == null || !Number.isFinite(val) || val < 0) return null;
  return val;
}

/** Wind speed: GeoMet often returns m/s; convert to km/h if value in 0–50 (m/s range). */
function windSpeedKmh(raw: number): number {
  if (raw <= 0) return 0;
  if (raw > 50) return raw; // likely already km/h
  return raw * 3.6; // m/s → km/h
}

/**
 * Fetch HRDPS 10 m wind at a point (speed km/h, direction degrees 0–360, meteorological "from").
 * time: optional ISO8601 valid time for forecast hour.
 * Returns null if either layer fails.
 * GeoMet HRDPS WindDir is opposite to SpotWX; add 180° so display matches SpotWX.
 */
export async function getHrdpsWind10m(
  lat: number,
  lon: number,
  time?: string
): Promise<{ speedKmh: number; dirDeg: number } | null> {
  const [speedVal, dirVal] = await Promise.all([
    getPointValue(COVERAGE_IDS.HRDPS_WIND_SPEED, lat, lon, time),
    getPointValue(COVERAGE_IDS.HRDPS_WIND_DIR, lat, lon, time),
  ]);
  if (speedVal == null || !Number.isFinite(speedVal) || speedVal < 0) return null;
  if (dirVal == null || !Number.isFinite(dirVal)) return { speedKmh: windSpeedKmh(speedVal), dirDeg: 0 };
  let dirDeg = ((dirVal % 360) + 360) % 360;
  dirDeg = (dirDeg + 180) % 360;
  return { speedKmh: windSpeedKmh(speedVal), dirDeg };
}

/**
 * Fetch RDPS 10 m wind at a point (speed km/h, direction degrees 0–360).
 * time: optional ISO8601 valid time for forecast hour.
 * Returns null if speed layer fails.
 * GeoMet RDPS WindDir used as-is to match SpotWX (no 180° correction).
 */
export async function getRdpsWind10m(
  lat: number,
  lon: number,
  time?: string
): Promise<{ speedKmh: number; dirDeg: number } | null> {
  const [speedVal, dirVal] = await Promise.all([
    getPointValue(COVERAGE_IDS.RDPS_WIND_SPEED, lat, lon, time),
    getPointValue(COVERAGE_IDS.RDPS_WIND_DIR, lat, lon, time),
  ]);
  if (speedVal == null || !Number.isFinite(speedVal) || speedVal < 0) return null;
  const dirDeg =
    dirVal != null && Number.isFinite(dirVal) ? (((dirVal % 360) + 360) % 360) : 0;
  return { speedKmh: windSpeedKmh(speedVal), dirDeg };
}

/**
 * Fetch RDPS 80 m wind at a point (speed km/h, direction degrees 0–360).
 * Use at summit for ridge-level wind. No 180° correction; use as-is to match SpotWX.
 */
export async function getRdpsWind80m(
  lat: number,
  lon: number,
  time?: string
): Promise<{ speedKmh: number; dirDeg: number } | null> {
  const [speedVal, dirVal] = await Promise.all([
    getPointValue(COVERAGE_IDS.RDPS_WIND_SPEED_80M, lat, lon, time),
    getPointValue(COVERAGE_IDS.RDPS_WIND_DIR_80M, lat, lon, time),
  ]);
  if (speedVal == null || !Number.isFinite(speedVal) || speedVal < 0) return null;
  const dirDeg =
    dirVal != null && Number.isFinite(dirVal) ? (((dirVal % 360) + 360) % 360) : 0;
  return { speedKmh: windSpeedKmh(speedVal), dirDeg };
}
