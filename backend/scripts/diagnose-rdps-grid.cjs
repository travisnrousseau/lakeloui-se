#!/usr/bin/env node
/**
 * Diagnose RDPS GRIB2 grid: fetch one RDPS AirTemp AGL-2m file, parse with vgrib2, print grid definition and sample values.
 * Run from backend: node scripts/diagnose-rdps-grid.cjs
 * Use: DEBUG_FORECAST=1 npm run dry-render (or this script) to see why RDPS temps may be wrong.
 */
const path = require('path');
const backendDir = path.join(__dirname, '..');
process.env.NODE_ENV = 'development';
process.env.VGRIB2_DEV_PATH = path.join(backendDir, 'node_modules', 'vgrib2', 'dist', 'vgrib2.cjs.development.js');

const axios = require('axios');

const URLS = { RDPS: 'https://dd.weather.gc.ca/today/model_rdps/10km' };

function getModelRunCandidates(intervalHours) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const today = now.toISOString().split('T')[0].replace(/-/g, '');
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  const runs = Array.from({ length: 24 / intervalHours }, (_, i) => (i * intervalHours).toString().padStart(2, '0')).reverse();
  const delay = intervalHours === 12 ? 8 : 5;
  const candidates = [];
  for (const run of runs) {
    if (utcHour >= parseInt(run, 10) + delay) candidates.push({ date: today, run });
  }
  for (const run of runs) {
    candidates.push({ date: yesterday, run });
  }
  return candidates;
}

function rdpsLatLonFileName(date, run, leadStr, variable, level) {
  return `${date}T${run}Z_MSC_RDPS_${variable}_${level}_RLatLon0.09_PT${leadStr}H.grib2`;
}

async function main() {
  const candidates = getModelRunCandidates(6);
  const leadStr = '006';
  let buffer = null;
  let url = null;
  for (const { date: d, run: r } of candidates) {
    url = `${URLS.RDPS}/${r}/${leadStr}/${rdpsLatLonFileName(d, r, leadStr, 'AirTemp', 'AGL-2m')}`;
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
      buffer = Buffer.from(res.data);
      console.log('Fetched:', url);
      break;
    } catch (e) {
      console.warn('Skip:', url, e.response?.status || e.message);
    }
  }
  if (!buffer) {
    console.error('Could not fetch any RDPS AirTemp AGL-2m file. Try again when a run is available (00/06/12/18 UTC + 5h).');
    process.exit(1);
  }

  const vgrib2 = require(process.env.VGRIB2_DEV_PATH || 'vgrib2/dist/vgrib2.cjs.development.js');
  const { GRIB } = vgrib2;
  let msg;
  try {
    const grib = GRIB.parseNoLookup(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    msg = grib[0];
  } catch (err) {
    console.error('Parse error:', err.message);
    process.exit(1);
  }

  const grid = msg.gridDefinition || {};
  const data = Array.isArray(msg.data) ? msg.data : [];
  console.log('\n--- Grid definition (vgrib2) ---');
  console.log(JSON.stringify({
    la1: grid.la1,
    lo1: grid.lo1,
    dx: grid.dx,
    dy: grid.dy,
    nx: grid.nx,
    ny: grid.ny,
    scanMode: grid.scanMode,
    LaD: grid.LaD,
    LoV: grid.LoV,
  }, null, 2));
  console.log('\nData length:', data.length);
  if (data.length > 0) {
    const sample = [data[0], data[Math.floor(data.length / 2)], data[data.length - 1]];
    console.log('Sample values (K):', sample.map((v) => (v - 273.15).toFixed(1) + '°C'));
    const valid = data.filter((v) => v >= 253 && v <= 295);
    console.log('Values in 253–295 K (plausible 2m temp):', valid.length);
  }
  console.log('\nLake Louise BASE (51.443, -116.162): if LaD/LoV are wrong scale or rotation wrong, extracted value will be wrong.');
  console.log('Run with DEBUG_FORECAST=1 npm run dry-render to see grid dump when value is implausible.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
