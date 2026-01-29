/**
 * Lake Louise Townsite (valley-floor) station fetcher.
 * Station ID: 3053759 (EC). Location: Banff NP / ID9.
 *
 * Status: Left in code only. Does not currently work; not planned to be restored.
 * Do NOT use for display or as a fallback (e.g. for Base/Summit). The fetcher returns null
 * without calling GeoMet (3053759 is not in SWOB or climate-hourly; verified 2026-01).
 * See docs/DATA_SOURCES.md §2 Valley-Floor Monitoring.
 */

import axios from "axios";

const MSC_GEOMET_BASE = "https://api.weather.gc.ca";
const REQUEST_TIMEOUT_MS = 60_000; // 1 min per call; Lambda timeout 2 min (was 8s; align with other fetchers)

/** EC climate station ID for Lake Louise Village (Townsite), 1,536 m */
export const TOWNSITE_CLIMATE_ID = "3053759";

export interface TownsiteData {
  stationId: string;
  stationName: string;
  temp: number | null;
  barSeaLevel: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  precipAmount: number | null;
  timestamp: string;
  source: "climate-hourly";
}

/** Returns null without calling GeoMet — 3053759 not in SWOB or climate-hourly. Re-enable fetch when source exists. */
export async function fetchTownsite(): Promise<TownsiteData | null> {
  return null;

  // Uncomment below when 3053759 is available in climate-hourly (AB) or SWOB:
  /*
  try {
    const res = await axios.get(`${MSC_GEOMET_BASE}/collections/climate-hourly/items`, {
      params: { f: "json", limit: 200, PROVINCE_CODE: "AB" },
      timeout: REQUEST_TIMEOUT_MS
    });
    const features = res.data?.features;
    if (!Array.isArray(features)) return null;
    const f = features.find(
      (x: { properties?: { CLIMATE_IDENTIFIER?: string } }) =>
        String(x?.properties?.CLIMATE_IDENTIFIER ?? "") === TOWNSITE_CLIMATE_ID
    );
    if (!f?.properties) return null;
    const p = f.properties;
    const kpa = p.STATION_PRESSURE != null ? Number(p.STATION_PRESSURE) : null;
    return {
      stationId: TOWNSITE_CLIMATE_ID,
      stationName: String(p.STATION_NAME ?? "Lake Louise Townsite"),
      temp: p.TEMP != null ? Number(p.TEMP) : null,
      barSeaLevel: kpa != null ? kpa * 10 : null,
      windSpeed: p.WIND_SPEED != null ? Number(p.WIND_SPEED) : null,
      windDirection: p.WIND_DIRECTION != null ? Number(p.WIND_DIRECTION) : null,
      precipAmount: p.PRECIP_AMOUNT != null ? Number(p.PRECIP_AMOUNT) : null,
      timestamp: String(p.LOCAL_DATE ?? p.UTC_DATE ?? new Date().toISOString()),
      source: "climate-hourly"
    };
  } catch (err) {
    console.warn("Townsite climate-hourly failed:", (err as Error).message);
    return null;
  }
  */
}
