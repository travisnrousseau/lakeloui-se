/**
 * Elevation lookup for "summit" point selection.
 * Picks (lat, lon) whose terrain elevation is closest to target (e.g. 2630 m)
 * so GeoMet temp queries use a cell at representative altitude.
 */

const OPEN_ELEVATION = "https://api.open-elevation.com/api/v1/lookup";

/** ~1 km step for 3×3 grid around center (Lake Louise area). */
const GRID_STEP_DEG = 0.01;

/**
 * Fetch terrain elevation (m) for points. Returns null for failed lookups.
 * Uses Open-Elevation API (free tier; single GET for small batches).
 */
export async function fetchElevations(
  points: Array<{ lat: number; lon: number }>
): Promise<(number | null)[]> {
  if (points.length === 0) return [];
  const locations = points.map((p) => `${p.lat},${p.lon}`).join("|");
  const url = `${OPEN_ELEVATION}?locations=${encodeURIComponent(locations)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return points.map(() => null);
    const data = (await res.json()) as { results?: Array<{ elevation?: number }> };
    const results = data?.results ?? [];
    return results.map((r) => (typeof r.elevation === "number" && Number.isFinite(r.elevation) ? r.elevation : null));
  } catch {
    return points.map(() => null);
  }
}

/**
 * Return (lat, lon, elevM) in a 3×3 grid around center whose elevation is closest to targetElevM.
 * Falls back to center if lookup fails or no valid elevations.
 */
export async function getSummitPointForTemp(
  center: { lat: number; lon: number },
  targetElevM: number
): Promise<{ lat: number; lon: number; elevM: number }> {
  const points: Array<{ lat: number; lon: number }> = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      points.push({
        lat: center.lat + di * GRID_STEP_DEG,
        lon: center.lon + dj * GRID_STEP_DEG,
      });
    }
  }
  const elevations = await fetchElevations(points);
  let best = { lat: center.lat, lon: center.lon, elevM: targetElevM };
  let bestDiff = Infinity;
  for (let i = 0; i < points.length; i++) {
    const elev = elevations[i];
    if (elev == null || !Number.isFinite(elev)) continue;
    const diff = Math.abs(elev - targetElevM);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { lat: points[i].lat, lon: points[i].lon, elevM: elev };
    }
  }
  return best;
}
