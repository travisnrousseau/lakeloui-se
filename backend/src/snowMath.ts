/**
 * Snow amount equations for mid vs upper mountain.
 * Uses SLR (snow-to-liquid ratio) from temperature and orographic elevation multiplier.
 * See docs/DATA_SOURCES.md and docs/CALCULATIONS.md.
 */

/** Mid-mountain (Pika) elevation, m (ASL) */
export const ELEV_PIKA_M = 2000;
/** Summit (Paradise) elevation, m (ASL) */
export const ELEV_SUMMIT_M = 2630;
/** Base area elevation, m (ASL) */
export const ELEV_BASE_M = 1650;

/** Orographic precipitation increase per metre elevation gain (~8% per 100 m in Rockies) */
const OROGRAPHIC_PER_M = 0.0008;
/** Elevation multiplier cap (max 1.6×) */
const ELEV_MULT_MAX = 1.6;
const ELEV_MULT_MIN = 1.0;

/** SLR bounds (ratio of snow depth to liquid equivalent; 10:1 = 10 cm snow per 1 cm water) */
const SLR_MIN = 5;
const SLR_MAX = 30;

/**
 * Snow-to-liquid ratio (SLR) from surface temperature.
 * Colder air → fluffier snow → higher ratio; warmer → wetter → lower ratio.
 * Empirical: SLR ≈ 10 + (0 − T) for T in °C, with bounds.
 * Ref: temperature-based SLR approximations (e.g. 10:1 baseline at 0°C; NWS/forecasting practice).
 *
 * @param tC Surface temperature, °C (e.g. from Pika or Paradise)
 * @returns SLR as numeric ratio (e.g. 20 = 20:1)
 */
export function slrFromTemp(tC: number): number {
  const slr = 10 + (0 - tC);
  return Math.max(SLR_MIN, Math.min(SLR_MAX, slr));
}

/**
 * Orographic precipitation multiplier by elevation.
 * Precipitation typically increases with elevation in mountain regions (~8% per 100 m).
 *
 * @param elevMid_m Mid (e.g. Pika) elevation, m
 * @param elevUpper_m Upper (e.g. summit) elevation, m
 * @returns Multiplier (1.0 to ELEV_MULT_MAX)
 */
export function orographicMultiplier(elevMid_m: number, elevUpper_m: number): number {
  const delta = elevUpper_m - elevMid_m;
  if (delta <= 0) return 1.0;
  const mult = 1 + delta * OROGRAPHIC_PER_M;
  return Math.max(ELEV_MULT_MIN, Math.min(ELEV_MULT_MAX, mult));
}

/**
 * Upper-mountain snow depth estimate from mid-mountain depth using:
 * - Orographic multiplier (more precip at higher elevation)
 * - SLR ratio (fluffier snow at colder upper temp → more cm per mm water)
 *
 * Formula: upper_cm = mid_cm × elev_mult × (SLR_upper / SLR_mid)
 *
 * When temps are missing, falls back to fixed 1.5× (resort convention).
 *
 * @param midCm Mid-mountain depth, cm (from resort/Pika)
 * @param tMid_C Mid-mountain temp, °C (from resort XML Pika location)
 * @param tUpper_C Upper/summit temp, °C (from WeatherLink Paradise)
 * @param elevMid_m Mid elevation, m (default ELEV_PIKA_M)
 * @param elevUpper_m Upper elevation, m (default ELEV_SUMMIT_M)
 * @returns Estimated upper-mountain depth, cm (rounded)
 */
export function upperDepthCm(
  midCm: number,
  tMid_C: number | null | undefined,
  tUpper_C: number | null | undefined,
  elevMid_m: number = ELEV_PIKA_M,
  elevUpper_m: number = ELEV_SUMMIT_M
): number {
  const hasTemps = tMid_C != null && tUpper_C != null && Number.isFinite(tMid_C) && Number.isFinite(tUpper_C);
  if (!hasTemps) {
    return Math.round(midCm * 1.5);
  }
  const slrMid = slrFromTemp(tMid_C);
  const slrUpper = slrFromTemp(tUpper_C);
  const mult = orographicMultiplier(elevMid_m, elevUpper_m);
  const upper = midCm * mult * (slrUpper / slrMid);
  return Math.round(Math.max(0, upper));
}

/**
 * Depth from SWE when we have liquid equivalent (mm) and temperature.
 * depth_cm = SWE_mm × SLR / 10  (since 10:1 means 10 cm snow per 10 mm water = 1 cm per 1 mm).
 * So depth_cm = SWE_mm × (SLR/10).
 *
 * @param sweMm Snow water equivalent, mm
 * @param tC Surface temp, °C (for SLR)
 * @returns Depth, cm
 */
export function depthCmFromSwe(sweMm: number, tC: number): number {
  const slr = slrFromTemp(tC);
  return (sweMm * slr) / 10;
}
