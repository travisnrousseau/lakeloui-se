/**
 * Forecast types used by GeoMet (HRDPS, RDPS, GDPS) and render.
 * Canadian models only; American (NAM/GFS) removed.
 */

export interface ForecastPeriod {
  leadHours: number;
  label: string;
  tempBase: number | null;
  tempSummit: number | null;
  windSpeed: number | null;
  windDir: number | null;
  source: string;
  precipMm?: number | null;
}

export interface DetailedForecast {
  hrdps: ForecastPeriod[];
  rdps: ForecastPeriod[];
  gdpsTrend: string;
  verticalProfile: { level: number; temp: number }[];
  pm25: number | null;
}
