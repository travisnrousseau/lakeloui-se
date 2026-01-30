#!/usr/bin/env node
/**
 * Check forecast extraction locally: fetch GeoMet (HRDPS, RDPS, GDPS) for Lake Louise and print temps.
 *
 * From backend directory:
 *   npm run check-forecast
 *
 * With debug logs:
 *   DEBUG_GEOMET=1 node scripts/check-forecast-local.cjs
 */
const path = require('path');
const backendDir = path.join(__dirname, '..');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const geomet = require(path.join(backendDir, 'dist', 'geometForecast.cjs'));

const LEADS = [6, 12, 24, 48];

function fmt(t) {
  if (t == null || !Number.isFinite(t)) return '—';
  return `${Math.round(t)}°C`;
}

async function main() {
  console.log('Fetching GeoMet detailed forecast (HRDPS, RDPS, GDPS)...');
  const detailed = await geomet.fetchGeometDetailedForecast();
  if (!detailed) {
    console.error('fetchGeometDetailedForecast() returned null.');
    process.exit(1);
  }

  console.log('\n--- HRDPS (Lake Louise BASE / PARADISE summit) ---');
  console.log('Lead    BASE    PARADISE   Precip');
  for (const lead of LEADS) {
    const p = (detailed.hrdps || []).find(x => x.leadHours === lead);
    if (!p) {
      console.log(`${lead}h      —        —`);
      continue;
    }
    const precip = p.precipMm != null && Number.isFinite(p.precipMm) ? `${p.precipMm.toFixed(1)} mm` : '—';
    console.log(`${lead}h      ${fmt(p.tempBase)}      ${fmt(p.tempSummit)}       ${precip}`);
  }

  console.log('\n--- RDPS (Lake Louise BASE / PARADISE summit) ---');
  console.log('Lead    BASE    PARADISE   Precip');
  for (const lead of LEADS) {
    const p = (detailed.rdps || []).find(x => x.leadHours === lead);
    if (!p) {
      console.log(`${lead}h      —        —`);
      continue;
    }
    const precip = p.precipMm != null && Number.isFinite(p.precipMm) ? `${p.precipMm.toFixed(1)} mm` : '—';
    console.log(`${lead}h      ${fmt(p.tempBase)}      ${fmt(p.tempSummit)}       ${precip}`);
  }

  const hrdpsAny = (detailed.hrdps || []).some(p => p.tempBase != null || p.tempSummit != null);
  const rdpsAny = (detailed.rdps || []).some(p => p.tempBase != null || p.tempSummit != null);
  if (!hrdpsAny && !rdpsAny) {
    console.error('\nNo temps extracted. Check DEBUG_GEOMET=1 for GeoMet logs.');
    process.exit(1);
  }
  console.log('\nGDPS trend:', detailed.gdpsTrend || '—');
  console.log('\nDone. Open /tmp/lakeloui_live_dry_index.html after "npm run dry-render" to see full page.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
