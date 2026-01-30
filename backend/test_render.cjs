#!/usr/bin/env node
/**
 * Render the index page so you can work on FORECAST (Bento) display locally.
 * Prefers backend/fixtures/cached-forecast.json (saved from a successful run_dry_render.cjs).
 * If USE_FIXTURE=1 or no cache: uses backend/fixtures/forecast-bento.json.
 *
 * Run: node test_render.cjs
 * Open: backend/bento-preview.html
 */
const fs = require("fs");
const path = require("path");

const fixturesDir = path.join(__dirname, "fixtures");
const cachePath = path.join(fixturesDir, "cached-forecast.json");
const bentoPath = path.join(fixturesDir, "forecast-bento.json");

let detailedForecast = null;
let msc = {};
let forecastTimeline = [];

if (process.env.USE_FIXTURE !== "1" && fs.existsSync(cachePath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    detailedForecast = raw.detailedForecast ?? null;
    msc = raw.msc ?? {};
    forecastTimeline = raw.forecastTimeline ?? [];
    const hasUsableTemps = detailedForecast?.hrdps?.some(p => p.tempBase != null || p.tempSummit != null) ||
      detailedForecast?.rdps?.some(p => p.tempBase != null || p.tempSummit != null);
    if (detailedForecast && !hasUsableTemps) detailedForecast = null;
    if (detailedForecast) console.log("Using cached model data from", raw.cachedAt || "fixtures/cached-forecast.json");
  } catch (e) {
    console.warn("Could not load cache:", e.message);
  }
}

if (!detailedForecast && fs.existsSync(bentoPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(bentoPath, "utf8"));
    detailedForecast = raw.detailedForecast ?? raw;
    if (detailedForecast) console.log("Using fixture forecast-bento.json");
  } catch (e) {
    console.warn("Could not load fixture:", e.message);
  }
}

if (!detailedForecast) {
  detailedForecast = {
    hrdps: [
      { leadHours: 3, label: "3h", tempBase: -4, tempSummit: -10, windSpeed: 12, windDir: 280, source: "HRDPS", precipMm: 0.5 },
      { leadHours: 6, label: "6h", tempBase: -3, tempSummit: -9, windSpeed: 18, windDir: 270, source: "HRDPS", precipMm: 2 },
      { leadHours: 12, label: "12h", tempBase: -2, tempSummit: -8, windSpeed: 22, windDir: 260, source: "HRDPS", precipMm: 4 },
      { leadHours: 18, label: "18h", tempBase: -5, tempSummit: -12, windSpeed: 15, windDir: 290, source: "HRDPS", precipMm: 1 },
      { leadHours: 24, label: "24h", tempBase: -6, tempSummit: -11, windSpeed: 20, windDir: 275, source: "HRDPS", precipMm: 3 },
      { leadHours: 36, label: "36h", tempBase: -7, tempSummit: -13, windSpeed: 25, windDir: 265, source: "HRDPS", precipMm: 2 },
      { leadHours: 48, label: "48h", tempBase: -4, tempSummit: -10, windSpeed: 14, windDir: 300, source: "HRDPS", precipMm: 0 }
    ],
    rdps: [
      { leadHours: 3, label: "3h", tempBase: -3, tempSummit: -9, windSpeed: 14, windDir: 275, source: "RDPS", precipMm: 0.8 },
      { leadHours: 6, label: "6h", tempBase: -2, tempSummit: -8, windSpeed: 20, windDir: 268, source: "RDPS", precipMm: 2.5 },
      { leadHours: 12, label: "12h", tempBase: -1, tempSummit: -7, windSpeed: 24, windDir: 262, source: "RDPS", precipMm: 5 },
      { leadHours: 18, label: "18h", tempBase: -4, tempSummit: -11, windSpeed: 16, windDir: 285, source: "RDPS", precipMm: 1.5 },
      { leadHours: 24, label: "24h", tempBase: -5, tempSummit: -10, windSpeed: 22, windDir: 272, source: "RDPS", precipMm: 4 },
      { leadHours: 36, label: "36h", tempBase: -6, tempSummit: -12, windSpeed: 26, windDir: 260, source: "RDPS", precipMm: 2 },
      { leadHours: 48, label: "48h", tempBase: -3, tempSummit: -9, windSpeed: 18, windDir: 295, source: "RDPS", precipMm: 0 }
    ],
    gdpsTrend: "Stable",
    verticalProfile: [
      { level: 1000, temp: -2 },
      { level: 925, temp: -4 },
      { level: 850, temp: -8 },
      { level: 700, temp: -14 },
      { level: 500, temp: -24 }
    ],
    pm25: 2
  };
}

const data = {
  weather: [
    { temp: -8, wind_speed: 20, wind_direction_deg: 320, feels_like: -10, data_ts: Math.floor(Date.now() / 1000) },
    { temp: -2, wind_speed: 10, wind_direction_deg: 180, feels_like: -3, data_ts: Math.floor(Date.now() / 1000) }
  ],
  detailedForecast,
  forecastTimeline,
  msc,
  aiScript: "Fixture (Bento preview)",
  stashName: "THE HORSESHOE",
  stashWhy: "Fixture",
  inversionActive: false,
  heavySnow: false,
  snowReport: null,
  snowReportUpdatedAt: undefined,
  sparklineSummit: undefined,
  sparklineBase: undefined
};

const outPath = path.join(__dirname, "bento-preview.html");
try {
  const mod = require("./dist/renderHtml.cjs");
  const html = mod.renderHtml(data);
  fs.writeFileSync(outPath, html, "utf8");
  console.log("WROTE", outPath);
  console.log("Open this file in a browser to work on FORECAST (Bento) display.");
} catch (err) {
  console.error("Render error:", err);
  process.exit(1);
}
