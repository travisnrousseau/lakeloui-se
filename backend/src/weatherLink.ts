import axios from "axios";

const WEATHERLINK_API_BASE = "https://api.weatherlink.com/v2";

export interface WeatherLinkData {
  station_id: number;
  station_name: string;
  ts?: number;
  sensors?: any[];
  data?: { sensors?: any[] };
}

/** Current record from a sensor: use first (latest) or last element; API may order either way. */
function currentRec(sensor: { data?: any[] }): any | null {
  const arr = sensor.data;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[0] ?? arr[arr.length - 1] ?? null;
}

/** Wind speed: API can return mph, m/s, or km/h (station-dependent). Only convert when clearly mph (0.1–40). */
function windSpeedKmh(raw: number): number {
  if (raw <= 0) return 0;
  if (raw > 60) return raw; // likely already km/h
  if (raw >= 0.1 && raw <= 40) return raw * 1.60934; // typical mph range → km/h
  return raw; // ambiguous, use as-is
}

/** Pick first defined number from record for a list of keys. */
function firstNum(rec: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = rec[k];
    if (v != null && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

/** Normalized vitals for UI — WeatherLink v2: temp, wind_* (km/h), wind_chill/heat_index, bar_sea_level (ISS/barometer). */
export function normalizeStationVitals(station: WeatherLinkData): {
  temp: number | null;
  wind_speed: number | null;
  wind_direction_deg: number | null;
  feels_like: number | null;
  bar_sea_level: number | null;
} {
  let temp: number | null = null;
  let wind_speed: number | null = null;
  let wind_direction_deg: number | null = null;
  let feels_like: number | null = null;
  let bar_sea_level: number | null = null;

  const sensors = station.sensors ?? (station as any).data?.sensors ?? [];
  for (const sensor of sensors) {
    const rec = currentRec(sensor);
    if (!rec) continue;
    // ISS (type 10) / non-ISS (type 12): temp; archive uses temp_out. API returns Fahrenheit → Celsius.
    if (temp == null && (rec.temp != null || rec.temp_out != null)) {
      const f = Number(rec.temp ?? rec.temp_out);
      temp = (f - 32) * (5 / 9);
    }
    // Wind: try all known field names (ISS and anemometer-only sensors). Normalize to km/h.
    if (wind_speed == null) {
      const raw = firstNum(
        rec,
        "wind_speed_last",
        "wind_speed",
        "wind_speed_avg_last_1_min",
        "wind_speed_avg_last_10_min",
        "wind_speed_hi_last_10_min",
        "wind_speed_hi_last_2_min"
      );
      if (raw != null) wind_speed = windSpeedKmh(raw);
    }
    if (wind_direction_deg == null) {
      wind_direction_deg = firstNum(
        rec,
        "wind_dir_last",
        "wind_direction",
        "wind_dir_scalar_avg_last_1_min",
        "wind_dir_scalar_avg_last_2_min",
        "wind_dir_scalar_avg_last_10_min",
        "wind_dir_at_hi_speed_last_2_min",
        "wind_dir_at_hi_speed_last_10_min"
      );
      if (wind_direction_deg != null) {
        // Debug: confirm which field supplied direction (degrees 0–360, meteorological "from").
        if (process.env.DEBUG_WEATHERLINK) {
          const windKeys = Object.keys(rec).filter((k) => k.includes("dir") || k.includes("wind"));
          console.log(`WeatherLink wind_dir: ${wind_direction_deg}° from record keys:`, windKeys);
        }
      } else if (wind_speed != null && process.env.DEBUG_WEATHERLINK) {
        // Wind speed present but no direction — log record keys to find correct field name.
        const windKeys = Object.keys(rec).filter((k) => k.includes("dir") || k.includes("wind"));
        console.log("WeatherLink: wind_speed present but no wind_direction; record wind/dir keys:", windKeys);
      }
    }
    if (feels_like == null && (rec.wind_chill != null || rec.heat_index != null)) {
      const f = rec.wind_chill != null ? Number(rec.wind_chill) : Number(rec.heat_index);
      feels_like = (f - 32) * (5 / 9);
    }
    if (bar_sea_level == null && (rec.bar_sea_level != null || rec.bar_absolute != null))
      bar_sea_level = rec.bar_sea_level != null ? Number(rec.bar_sea_level) : Number(rec.bar_absolute);
  }

  return { temp, wind_speed, wind_direction_deg, feels_like, bar_sea_level };
}

/**
 * GET /stations/{station-ids} — metadata for specific stations.
 * station-ids: comma-delimited, max 100; integer or UUID.
 */
export interface WeatherLinkStationMetadata {
  station_id?: number;
  station_name?: string;
  [key: string]: unknown;
}

export async function fetchWeatherLinkStationsMetadata(
  stationIds: (number | string)[],
  apiKey: string,
  apiSecret: string
): Promise<WeatherLinkStationMetadata[]> {
  if (stationIds.length === 0) return [];
  const ids = stationIds.slice(0, 100).join(",");
  const response = await axios.get(`${WEATHERLINK_API_BASE}/stations/${ids}`, {
    params: { "api-key": apiKey },
    headers: { "X-Api-Secret": apiSecret },
    timeout: 30_000,
  });
  const body = response.data as { stations?: WeatherLinkStationMetadata[] };
  const list = body?.stations ?? (Array.isArray(body) ? body : []);
  return list;
}

/**
 * WeatherLink v2 uses api-key (query) and X-Api-Secret (header). Signature is deprecated.
 */
export async function fetchWeatherLinkStation(
  stationId: number,
  apiKey: string,
  apiSecret: string
): Promise<WeatherLinkData> {
  const response = await axios.get(`${WEATHERLINK_API_BASE}/current/${stationId}`, {
    params: { "api-key": apiKey },
    headers: { "X-Api-Secret": apiSecret },
    timeout: 60_000, // 1 min per call; Lambda timeout 2 min
  });
  const body = response.data as any;
  // Some APIs wrap in .data; top-level can be { station_id, sensors } or { data: { station_id, sensors } }
  const station = body?.data != null && typeof body.data === "object" ? body.data : body;
  return {
    station_id: station?.station_id ?? stationId,
    station_name: (body?.station_name ?? station?.station_name) as string,
    sensors: station?.sensors ?? [],
    ...(station?.ts != null && { ts: station.ts })
  };
}

/** Ordered slots: [Paradise Top, Base (Operations)]. Missing or failed fetches yield null. */
const WEATHERLINK_SLOTS: { envKey: string; displayName: string }[] = [
  { envKey: "WEATHERLINK_STATION_ID", displayName: "Paradise Top" },
  { envKey: "WEATHERLINK_STATION_ID_BASE", displayName: "Base (Operations)" },
];

/**
 * Fetches WeatherLink v2 current for Paradise Top and Base (Operations).
 * Returns [Paradise, Base] in that order so render uses index 0 = summit, index 1 = base.
 * Set WEATHERLINK_API_KEY, WEATHERLINK_API_SECRET; WEATHERLINK_STATION_ID (Paradise), WEATHERLINK_STATION_ID_BASE (Base).
 */
export async function fetchAllWeatherLinkStations(): Promise<(WeatherLinkData | null)[]> {
  const apiKey = process.env.WEATHERLINK_API_KEY;
  const apiSecret = process.env.WEATHERLINK_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.warn("WeatherLink API credentials missing (WEATHERLINK_API_KEY, WEATHERLINK_API_SECRET). Skipping fetch.");
    return [null, null];
  }

  const results: (WeatherLinkData | null)[] = [];
  const promises = WEATHERLINK_SLOTS.map(async (slot) => {
    const raw = process.env[slot.envKey];
    const stationId = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isInteger(stationId)) return null;
    try {
      const data = await fetchWeatherLinkStation(stationId, apiKey, apiSecret);
      return { ...data, station_name: slot.displayName };
    } catch (error) {
      console.error(`Error fetching WeatherLink ${slot.displayName} (${slot.envKey}):`, error);
      return null;
    }
  });

  const settled = await Promise.all(promises);
  return settled;
}
