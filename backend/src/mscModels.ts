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

/** One day in the 7-day table: low/high for base and summit (min/max over the 24h window). */
export interface ForecastDay {
  leadHours: number;
  label: string;
  tempBaseLow: number | null;
  tempBaseHigh: number | null;
  tempSummitLow: number | null;
  tempSummitHigh: number | null;
  windSpeed: number | null;
  windDir: number | null;
  source: string;
  precipMm: number | null;
}

export interface DetailedForecast {
  hrdps: ForecastPeriod[];
  rdps: ForecastPeriod[];
  /** RDPS and GDPS for 7-day table (leads 24, 48, 72, 96, 120, 144, 168 h). */
  rdps7d?: ForecastPeriod[];
  gdps7d?: ForecastPeriod[];
  /** 7-day table with daily low/high per elevation (when available). */
  rdps7dDays?: ForecastDay[];
  gdps7dDays?: ForecastDay[];
  gdpsTrend: string;
  verticalProfile: { level: number; temp: number }[];
  pm25: number | null;
}
