#!/usr/bin/env node
/**
 * Diagnose HRDPS GRIB2 grid: try Continental 2.5km then West 1km TMP 2m, parse with vgrib2, print grid and sample values.
 * Run from backend: node scripts/diagnose-hrdps-grid.cjs
 * HRDPS wrong values (e.g. 7–8°C for Lake Louise in winter) often mean wrong LaD/LoV or wrong grid; we prefer Continental.
 */
const path = require('path');
const backendDir = path.join(__dirname, '..');
process.env.NODE_ENV = 'development';
process.env.VGRIB2_DEV_PATH = path.join(backendDir, 'node_modules', 'vgrib2', 'dist', 'vgrib2.cjs.development.js');

const axios = require('axios');

const COORDS = { BASE: { lat: 51.443204, lon: -116.161562 }, PARADISE: { lat: 51.460321, lon: -116.131901 } };

function getLatestHrdpsRun() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
  if (utcHour >= 19) return { date: dateStr, run: '12' };
  if (utcHour >= 6) return { date: dateStr, run: '00' };
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  return { date: yesterday.toISOString().split('T')[0].replace(/-/g, ''), run: '12' };
}

async function main() {
  const { date, run } = getLatestHrdpsRun();
  const leadStr = '003';
  const sources = [
    {
      name: 'Continental 2.5km (no /today/)',
      url: `https://dd.weather.gc.ca/model_hrdps/continental/2.5km/${run}/${leadStr}/${date}T${run}Z_MSC_HRDPS_TMP_AGL-2m_RLatLon0.0225_PT${leadStr}H.grib2`,
    },
    {
      name: 'West 1km',
      url: `https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2/${run}/${leadStr}/CMC_hrdps_west_TMP_TGL_2_rotated_latlon0.009x0.009_${date}T${run}Z_P${leadStr}-00.grib2`,
    },
  ];

  let buffer = null;
  let usedSource = null;
  for (const src of sources) {
    try {
      const res = await axios.get(src.url, { responseType: 'arraybuffer', timeout: 60000 });
      buffer = Buffer.from(res.data);
      usedSource = src.name;
      console.log('Fetched:', src.name, '\n', src.url);
      break;
    } catch (e) {
      console.warn('Skip', src.name, e.response?.status || e.message);
    }
  }
  if (!buffer) {
    console.error('Could not fetch any HRDPS TMP 2m file. Try again when 00 or 12Z run is available.');
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
    source: usedSource,
    la1: grid.la1,
    lo1: grid.lo1,
    la2: grid.la2,
    lo2: grid.lo2,
    dx: grid.dx,
    dy: grid.dy,
    nx: grid.nx,
    ny: grid.ny,
    scanMode: grid.scanMode,
    LaD: grid.LaD,
    LoV: grid.LoV,
  }, null, 2));
  console.log('\nData length:', data.length);

  function geographicToRotated(latDeg, lonDeg, LaD, LoV) {
    const toRad = Math.PI / 180;
    const lat = latDeg * toRad;
    const lon = lonDeg * toRad;
    const spLat = LaD * toRad;
    const spLon = LoV * toRad;
    const lonShifted = lon - spLon;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinSpLat = Math.sin(spLat);
    const cosSpLat = Math.cos(spLat);
    const sinLon = Math.sin(lonShifted);
    const cosLon = Math.cos(lonShifted);
    const latRot = Math.asin(sinSpLat * sinLat + cosSpLat * cosLat * cosLon);
    const lonRot = Math.atan2(cosLat * sinLon, sinSpLat * cosLat * cosLon - cosSpLat * sinLat);
    let latRotDeg = (latRot * 180) / Math.PI;
    let lonRotDeg = (lonRot * 180) / Math.PI;
    if (lonRotDeg < 0) lonRotDeg += 360;
    return { lat: latRotDeg, lon: lonRotDeg };
  }

  if (usedSource === 'West 1km') {
    let la1 = grid.la1;
    let lo1 = grid.lo1;
    let dx = grid.dx;
    let dy = grid.dy;
    const nx = grid.nx;
    const ny = grid.ny;
    const scanMode = grid.scanMode ?? 0;
    if (Math.abs(la1) > 360) {
      la1 /= 1e6;
      lo1 /= 1e6;
      dx /= 1e6;
      dy /= 1e6;
    }
    const la2Norm = grid.la2 != null ? (Math.abs(grid.la2) > 360 ? grid.la2 / 1e6 : grid.la2) : la1 + (ny - 1) * dy;
    const lo2Norm = grid.lo2 != null ? (Math.abs(grid.lo2) > 360 ? grid.lo2 / 1e6 : grid.lo2) : lo1 + (nx - 1) * dx;
    const latMin = Math.min(la1, la2Norm);
    const latMax = Math.max(la1, la2Norm);
    const lonMin = Math.min(lo1, lo2Norm);
    const lonMax = Math.max(lo1, lo2Norm);
    const getValueAt = (latG, lonG) => {
      const jRaw = (scanMode & 2) ? (la1 - latG) / dy : (latG - la1) / dy;
      const iRaw = (scanMode & 1) ? (lo1 - lonG) / dx : (lonG - lo1) / dx;
      const j = Math.max(0, Math.min(ny - 1, Math.round(jRaw)));
      const i = Math.max(0, Math.min(nx - 1, Math.round(iRaw)));
      // Match mscModels.ts: HRDPS West 1km is column-major
      const idx = i * ny + j;
      return { value: data[idx] ?? null, i, j, index: idx };
    };
    const adjustLon = (lng) => (lng >= 0 && lng < 220 ? lng + 144 : lng);
    const inBounds = (lg, lng) => {
      const lngA = adjustLon(lng);
      const inLat = lg >= latMin && lg <= latMax;
      const inLon = (lngA >= lonMin && lngA <= lonMax) || (lngA + 360 >= lonMin && lngA + 360 <= lonMax) || (lngA - 360 >= lonMin && lngA - 360 <= lonMax);
      return inLat && inLon;
    };
    const poles = [
      { label: 'raw/67.5', LaD: Math.abs(grid.LaD) >= 1000 && Math.abs(grid.LaD) <= 5000 ? grid.LaD / 67.5 : null, LoV: grid.LoV > 180 ? grid.LoV - 360 : grid.LoV },
      { label: '31.7583,-114.092', LaD: 31.7583, LoV: -114.092 },
      { label: '-31.7583,-114.092', LaD: -31.7583, LoV: -114.092 },
      { label: '31.7583,65.908', LaD: 31.7583, LoV: 65.908 },
      { label: '-31.7583,65.908', LaD: -31.7583, LoV: 65.908 },
    ].filter((p) => p.LaD != null);
    console.log('\n--- Rotated coords and value for Lake Louise BASE ---');
    console.log('Grid bounds (deg): lat', latMin.toFixed(4), '-', latMax.toFixed(4), ', lon', lonMin.toFixed(4), '-', lonMax.toFixed(4));
    for (const pole of poles) {
      const { lat: latG, lon: lonG } = geographicToRotated(COORDS.BASE.lat, COORDS.BASE.lon, pole.LaD, pole.LoV);
      const lngAdj = adjustLon(lonG);
      const res = getValueAt(latG, lngAdj);
      const ib = inBounds(latG, lonG);
      const tempC = typeof res.value === 'number' ? (res.value - 273.15).toFixed(1) : '(data not decoded)';
      console.log(`  ${pole.label}: (latG,lonG)=(${latG.toFixed(4)}, ${lonG.toFixed(4)}) adjLon=${lngAdj.toFixed(4)} inBounds=${ib} (i,j)=(${res.i},${res.j}) value=${res.value} K => ${tempC}°C`);
    }
  }

  if (data.length > 0) {
    const sample = [data[0], data[Math.floor(data.length / 2)], data[data.length - 1]];
    console.log('\nSample values (K):', sample.map((v) => (typeof v === 'number' ? (v - 273.15).toFixed(1) : v) + '°C'));
    const valid = data.filter((v) => typeof v === 'number' && v >= 253 && v <= 295);
    console.log('Values in 253–295 K (plausible 2m temp):', valid.length);
  }
  console.log('\nLake Louise BASE', COORDS.BASE, 'PARADISE', COORDS.PARADISE);
  console.log('If LaD/LoV are wrong scale (e.g. LaD ~ -2114 for West 1km), rotation will be wrong → wrong cell → wrong temp.');
  console.log('We prefer Continental 2.5km; run FORCE_FETCH=1 npm run dry-render to refetch.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
