#!/usr/bin/env node
process.env.NODE_ENV = 'development';
const path = require('path');
const backendDir = __dirname;

const fs = require('fs');

// Load .env from backend dir (WEATHERLINK_API_*, OPENROUTER_API_KEY, etc.; optional).
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf8');
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const stripped = trimmed.replace(/^\s*export\s+/, '');
    const m = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      count++;
    }
  }
  return count;
}
const envPath = path.join(__dirname, '.env');
const envPathCwd = path.join(process.cwd(), '.env');
const loaded = loadEnv(envPath) || loadEnv(envPathCwd);
if (loaded > 0) {
  console.log('Loaded .env (', loaded, 'vars). OPENROUTER_API_KEY set:', !!process.env.OPENROUTER_API_KEY);
} else {
  console.log('No .env found at', envPath, 'or', envPathCwd, '— OPENROUTER_API_KEY will be unset unless in shell.');
}

const CACHE_FILE = path.join(__dirname, 'fixtures', 'dry-run-cache.json');
// Bump when extraction/code changes so old forecast cache is not reused (GeoMet HRDPS/RDPS precip/wind).
const CACHE_VERSION = 15;
// Use cached data when fresh. Set FORCE_FETCH=1 only when you need to refresh (e.g. after 5h); otherwise we do not redownload models.
const FORCE_FETCH = process.env.FORCE_FETCH === '1' || process.env.FORCE_FETCH === 'true';

// Per-source max cache age (minutes). Fetch only when stale — good-neighbor to WeatherLink, ECCC, WaterOffice, resort, Pika/Skoki.
const MAX_AGE = {
  weatherLink: Math.max(0, parseInt(process.env.MAX_CACHE_AGE_WEATHERLINK || '15', 10)),   // every 15 min
  water: Math.max(0, parseInt(process.env.MAX_CACHE_AGE_WATER || '120', 10)),              // 2h — GOES stations report 1–6h
  pikaSkoki: Math.max(0, parseInt(process.env.MAX_CACHE_AGE_PIKA_SKOKI || '120', 10)),    // 2h — same as water
  models: Math.max(0, parseInt(process.env.MAX_CACHE_AGE_MODELS || '300', 10)),            // 5h — ECCC runs (RDPS ~6h, HRDPS/GDPS ~12h)
  resort: 15,   // 15 min when in fetch window (3am–3pm local); see isResortFetchWindow()
};

// Townsite is disabled: EC station 3053759 not in SWOB/climate-hourly (see townsite.ts, docs). Never fetch.
const TOWNSITE_DISABLED = true;
// Canadian models via GeoMet (HRDPS, RDPS, GDPS). For local dry-render, enable by default so 48h forecast appears; set GEOMET_ENABLED=0 to disable.
const GEOMET_ENABLED = process.env.GEOMET_ENABLED === '1' || process.env.GEOMET_ENABLED === 'true'
  || (process.env.NODE_ENV === 'development' && process.env.GEOMET_ENABLED !== '0' && process.env.GEOMET_ENABLED !== 'false');

function isFresh(cachedAt, maxAgeMinutes) {
  if (!cachedAt || maxAgeMinutes <= 0) return false;
  const ageMs = Date.now() - new Date(cachedAt).getTime();
  return ageMs >= 0 && ageMs < maxAgeMinutes * 60 * 1000;
}

// Resort XML: fetch only 3am–3pm local (ski report updates during day). Use server local time (MST/MDT for Lake Louise).
function isResortFetchWindow() {
  const hour = new Date().getHours();
  return hour >= 3 && hour < 15;
}

const wl = require('./dist/weatherLink.cjs');
const water = require('./dist/waterOffice.cjs');
const pikaSkoki = require('./dist/pikaSkoki.cjs');
const town = require('./dist/townsite.cjs');
const resort = require('./dist/resortXml.cjs');
const render = require('./dist/renderHtml.cjs');
const openRouter = require('./dist/openRouter.cjs');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { makeEmailSafe } = require('./dist/emailHtml.cjs');

(async () => {
  try {
    let weatherLinkData = [null, null], waterData = [], pikaData = null, skokiData = null, forecastTimeline = [], detailedForecast = null, townsiteData = null, resortData = null;
    let cache = {};
    if (!FORCE_FETCH && fs.existsSync(CACHE_FILE)) {
      try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      } catch (e) {
        console.warn('Cache read failed:', e.message || e);
      }
    }

    const needWeatherLink = FORCE_FETCH || !isFresh(cache.weatherLinkAt, MAX_AGE.weatherLink);
    const needWater = FORCE_FETCH || !isFresh(cache.waterAt, MAX_AGE.water);
    const needPikaSkoki = FORCE_FETCH || !isFresh(cache.pikaSkokiAt, MAX_AGE.pikaSkoki);
    const needModels = FORCE_FETCH || cache.version !== CACHE_VERSION || !isFresh(cache.modelsAt, MAX_AGE.models);
    const needTownsite = !TOWNSITE_DISABLED && (FORCE_FETCH || !isFresh(cache.townsiteAt, parseInt(process.env.MAX_CACHE_AGE_TOWNSITE || '15', 10)));
    const needResort = isResortFetchWindow() && (FORCE_FETCH || !isFresh(cache.resortAt, MAX_AGE.resort));

    if (!needWeatherLink && cache.weatherLinkData != null) weatherLinkData = cache.weatherLinkData;
    if (!needWater && cache.waterData != null) waterData = cache.waterData;
    if (!needPikaSkoki && cache.pikaData !== undefined) pikaData = cache.pikaData;
    if (!needPikaSkoki && cache.skokiData !== undefined) skokiData = cache.skokiData;
    if (!needModels && (GEOMET_ENABLED || !NOAA_DISABLED) && (cache.forecastTimeline != null || cache.detailedForecast != null)) {
      forecastTimeline = cache.forecastTimeline ?? [];
      detailedForecast = cache.detailedForecast ?? null;
    }
    if (!needTownsite && cache.townsiteData !== undefined) townsiteData = cache.townsiteData;
    if (!needResort && cache.resortData !== undefined) resortData = cache.resortData;

    if (needWeatherLink) {
      console.log('Fetching WeatherLink stations (cache stale or missing, max age ' + MAX_AGE.weatherLink + ' min)...');
      try {
        weatherLinkData = await wl.fetchAllWeatherLinkStations();
        console.log('WeatherLink fetched.');
      } catch (e) {
        console.warn('WeatherLink fetch failed:', e.message || e);
      }
    } else {
      console.log('WeatherLink: using cache (fresh).');
    }

    if (needWater) {
      console.log('Fetching water stations (cache stale or missing, max age ' + MAX_AGE.water + ' min)...');
      try {
        waterData = await water.fetchAllWaterStations();
      } catch (e) {
        console.warn('WaterOffice fetch failed:', e.message || e);
      }
    } else {
      console.log('Water: using cache (fresh).');
    }

    if (needPikaSkoki) {
      console.log('Fetching Pika & Skoki (GOES-18 / Alberta River Basins, cache stale or missing)...');
      try {
        [pikaData, skokiData] = await Promise.all([pikaSkoki.fetchPika(), pikaSkoki.fetchSkoki()]);
        if (pikaData) console.log('Pika (GOES-18) fetched.');
        if (skokiData) console.log('Skoki (GOES-18) fetched.');
      } catch (e) {
        console.warn('Pika/Skoki fetch failed:', e.message || e);
      }
    } else {
      console.log('Pika/Skoki: using cache (fresh).');
    }

    if (needModels && GEOMET_ENABLED) {
      console.log('Fetching Canadian models via GeoMet (cache stale or missing, max age ' + MAX_AGE.models + ' min)...');
      try {
        const geomet = require('./dist/geometForecast.cjs');
        forecastTimeline = await geomet.fetchGeometForecastTimeline();
        detailedForecast = await geomet.fetchGeometDetailedForecast();
        console.log('GeoMet forecast: ' + forecastTimeline.length + ' timeline period(s), HRDPS ' + (detailedForecast?.hrdps?.length ?? 0) + ', GDPS trend: ' + (detailedForecast?.gdpsTrend ? 'yes' : 'no'));
      } catch (e) {
        console.warn('GeoMet forecast fetch failed:', e.message || e);
      }
    } else if (needModels && !NOAA_DISABLED) {
      console.log('Fetching NOAA NAM + GFS (cache stale or missing, max age ' + MAX_AGE.models + ' min)...');
      try {
        forecastTimeline = await noaa.fetchNoaaForecastTimeline();
        detailedForecast = await noaa.fetchNoaaDetailedForecast();
        console.log('NOAA forecast: ' + forecastTimeline.length + ' timeline periods, NAM ' + (detailedForecast?.nam?.length ?? 0) + ', GFS ' + (detailedForecast?.gfs?.length ?? 0));
      } catch (e) {
        console.warn('NOAA forecast fetch failed:', e.message || e);
      }
    } else if (needModels && NOAA_DISABLED && !GEOMET_ENABLED) {
      forecastTimeline = [];
      detailedForecast = null;
      console.log('Models: American (NAM/GFS) disabled and GeoMet not enabled — skipping fetch.');
    } else {
      console.log('Models: using cache (fresh).');
    }

    if (needTownsite) {
      console.log('Fetching townsite...');
      try {
        townsiteData = await town.fetchTownsite();
      } catch (e) {
        console.warn('Townsite fetch failed:', e.message || e);
      }
    } else if (TOWNSITE_DISABLED) {
      townsiteData = null;
      console.log('Townsite: disabled (source not available; see docs).');
    } else {
      if (cache.townsiteData !== undefined) townsiteData = cache.townsiteData;
      console.log('Townsite: using cache (fresh).');
    }

    if (needResort) {
      console.log('Fetching resort XML (3am–3pm window, 15 min; will compare hash)...');
      try {
        const newResort = await resort.fetchResortXml();
        const cachedHash = cache.resortData?.xmlHash || cache.resortHash;
        if (cachedHash && newResort.xmlHash === cachedHash) {
          resortData = cache.resortData ?? newResort;
          console.log('Resort: content unchanged (hash match), using cached data.');
        } else {
          resortData = newResort;
          console.log('Resort: fetched (new or changed).');
        }
      } catch (e) {
        console.warn('Resort XML fetch failed:', e.message || e);
        if (cache.resortData !== undefined) resortData = cache.resortData;
      }
    } else {
      if (cache.resortData !== undefined) resortData = cache.resortData;
      if (isResortFetchWindow()) {
        console.log('Resort: using cache (fresh).');
      } else {
        console.log('Resort: using cache (outside 3am–3pm fetch window).');
      }
    }

    // If live forecast has no usable temps (e.g. GRIB decode failed), use fixture for display so the table isn't all "—".
    const liveDetailedForecast = detailedForecast;
    const hasUsableTemps = detailedForecast?.hrdps?.some(p => p.tempBase != null || p.tempSummit != null) ||
      detailedForecast?.rdps?.some(p => p.tempBase != null || p.tempSummit != null);
    if (detailedForecast && !hasUsableTemps) {
      const fixturePath = path.join(__dirname, 'fixtures', 'forecast-bento.json');
      if (fs.existsSync(fixturePath)) {
        try {
          const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
          detailedForecast = fixture.detailedForecast || fixture;
          console.log('Using fixture forecast for display (live decode had no temps).');
        } catch (e) {
          console.warn('Could not load fixture for fallback:', e.message);
        }
      }
    }

    // Normalize weather link data for render (use normalizeStationVitals if available)
    let weatherForRender = [];
    try {
      const norm = wl.normalizeStationVitals;
      weatherForRender = (weatherLinkData || []).map(s => s ? norm(s) : {});
    } catch (e) {
      weatherForRender = [];
    }

    const barHigh = weatherForRender.some((w) => w.bar_sea_level != null && w.bar_sea_level > 1018);
    const pikaSnowReport = resortData ? resort.getPikaSnowReport(resortData) : null;
    const heavySnow = pikaSnowReport != null && pikaSnowReport.snow24Hours >= 15;

    function is4amReport() {
      if (process.env.REPORT_TYPE === '4am') return true;
      const mst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Edmonton' }));
      return mst.getHours() === 4;
    }
    const use4amReport = is4amReport();
    let aiScript = 'Dry run render';
    let stashName = 'THE HORSESHOE';
    let stashWhy = 'Dry run render';
    let stashCardLabel = 'STASH FINDER';
    if (process.env.OPENROUTER_API_KEY) {
      console.log('OpenRouter: API key present, reportType=' + (use4amReport ? '4am' : '6am') + ', calling generateForecast...');
      const payload = {
        summit_temp_c: weatherForRender[0]?.temp ?? null,
        base_temp_c: weatherForRender[1]?.temp ?? null,
        summit_wind_kmh: weatherForRender[0]?.wind_speed ?? null,
        base_wind_kmh: weatherForRender[1]?.wind_speed ?? null,
        summit_wind_dir_deg: weatherForRender[0]?.wind_direction_deg ?? null,
        base_wind_dir_deg: weatherForRender[1]?.wind_direction_deg ?? null,
        inversion_active: barHigh,
        snow_24h_cm: pikaSnowReport?.snow24Hours ?? null,
        snow_overnight_cm: pikaSnowReport?.snowOverNight ?? null,
        open_lifts: [],
        groomed_runs: [],
        history_alert: null
      };
      if (resortData?.report?.facilities?.areas?.area) {
        const areas = resortData.report.facilities.areas.area;
        const openLifts = [];
        const groomedRuns = [];
        for (const area of areas) {
          for (const lift of area.lifts?.lift ?? []) {
            if (lift?.status === 'Open' && lift?.name) openLifts.push(String(lift.name));
          }
          for (const trail of area.trails?.trail ?? []) {
            if (trail?.status === 'Open' && String(trail?.groomed ?? '').toLowerCase() === 'yes' && trail?.name) {
              groomedRuns.push(String(trail.name));
            }
          }
        }
        payload.open_lifts = openLifts;
        payload.groomed_runs = groomedRuns;
      }
      // 4am report: add 12h forecast, freezing level, Pika time, physics flags (same as handler)
      payload.snow_report_observed_at = pikaSnowReport?.lastSnowfallUpdate ?? pikaSnowReport?.lastSnowfallDate ?? null;
      const hrdps12 = (detailedForecast && detailedForecast.hrdps) || forecastTimeline || [];
      const hrdpsPeriods = hrdps12.filter(
        (p) => p.leadHours <= 12 && (p.source === 'HRDPS' || !(detailedForecast && detailedForecast.hrdps && detailedForecast.hrdps.length))
      );
      const period12 = hrdpsPeriods.find((p) => p.leadHours === 12) ?? hrdpsPeriods.find((p) => p.leadHours === 6);
      let forecast12hPrecipMm = null;
      if (hrdpsPeriods.length > 0) {
        const sum = hrdpsPeriods.reduce((acc, p) => acc + (p.precipMm ?? 0), 0);
        forecast12hPrecipMm = sum > 0 ? sum : null;
      }
      payload.forecast_12h_precip_mm = forecast12hPrecipMm ?? null;
      payload.forecast_12h_wind_kmh = period12?.windSpeed ?? null;
      payload.forecast_12h_wind_dir_deg = period12?.windDir ?? null;
      payload.forecast_12h_temp_base_c = period12?.tempBase ?? null;
      payload.forecast_12h_temp_summit_c = period12?.tempSummit ?? null;
      const vp = detailedForecast?.verticalProfile ?? [];
      let freezingLevel = null;
      if (vp.length >= 2) {
        const sorted = [...vp].sort((a, b) => a.level - b.level);
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i];
          const b = sorted[i + 1];
          if ((a.temp <= 0 && b.temp >= 0) || (a.temp >= 0 && b.temp <= 0)) {
            const t = (0 - a.temp) / (b.temp - a.temp);
            freezingLevel = Math.round(a.level + t * (b.level - a.level));
            break;
          }
        }
      }
      payload.freezing_level_m = freezingLevel;
      const baseTemp = weatherForRender[1]?.temp;
      const summitTemp = weatherForRender[0]?.temp;
      const sumWind = weatherForRender[0]?.wind_speed;
      const baseWind = weatherForRender[1]?.wind_speed;
      const sumDir = weatherForRender[0]?.wind_direction_deg;
      const isWesterly = (deg) => deg >= 180 && deg <= 360;
      const isWSW = (deg) => deg >= 225 && deg <= 315;
      payload.physics_chinook = baseTemp != null && summitTemp != null && baseTemp > summitTemp && sumDir != null && isWSW(sumDir);
      payload.physics_orographic = sumDir != null && isWesterly(sumDir) && (forecast12hPrecipMm ?? 0) > 0;
      payload.physics_valley_channelling = (sumWind != null && baseWind != null && sumWind - baseWind > 15) || (sumWind != null && sumWind > 40);

      try {
        const reportType = use4amReport ? '4am' : '6am';
        const result = await openRouter.generateForecast(payload, reportType);
        if (result) {
          if (use4amReport) {
            stashCardLabel = '04:00 REPORT';
            stashName = '04:00 REPORT';
            stashWhy = result.summary;
            aiScript = "Technical brief for Snow Reporters in the 04:00 card below.";
            console.log('OpenRouter 4am report generated. stashWhy length:', (result.summary || '').length);
          } else {
            aiScript = result.summary;
            if (result.stash_name) stashName = result.stash_name;
            if (result.stash_note) stashWhy = result.stash_note;
            console.log('OpenRouter forecast generated. summary:', (result.summary || '').slice(0, 80) + (result.summary && result.summary.length > 80 ? '...' : ''));
          }
        } else {
          console.log('OpenRouter: generateForecast returned null (check openRouter logs above).');
        }
      } catch (e) {
        console.warn('OpenRouter forecast failed, using placeholder:', e.message);
        if (e.response) console.warn('OpenRouter response status:', e.response.status, 'data:', JSON.stringify(e.response.data).slice(0, 200));
      }
    } else {
      console.log('OpenRouter: OPENROUTER_API_KEY not set, using placeholder hero/stash.');
    }

    const renderData = {
      weather: weatherForRender,
      forecastTimeline,
      detailedForecast: detailedForecast ?? undefined,
      aiScript,
      stashName,
      stashWhy,
      stashCardLabel,
      inversionActive: barHigh,
      heavySnow,
      snowReport: pikaSnowReport ?? null,
      snowReportUpdatedAt: pikaSnowReport ? new Date().toISOString() : undefined,
      goesStations: { pika: pikaData ?? undefined, skoki: skokiData ?? undefined },
      waterOffice: waterData.length > 0 ? waterData : undefined,
      sparklineSummit: undefined,
      sparklineBase: undefined
    };

    const html = render.renderHtml(renderData);
    fs.writeFileSync('/tmp/lakeloui_live_dry_index.html', html, 'utf8');
    fs.writeFileSync('/tmp/lakeloui_test_index.html', html, 'utf8');
    console.log('WROTE /tmp/lakeloui_live_dry_index.html and /tmp/lakeloui_test_index.html');

    // 4am report email: send when REPORT_TYPE=4am and REPORT_4AM_EMAIL + SES_FROM_EMAIL set (e.g. in .env)
    const reportType = process.env.REPORT_TYPE || '';
    const report4amEmail = (process.env.REPORT_4AM_EMAIL || '').trim();
    const sesFromEmail = (process.env.SES_FROM_EMAIL || '').trim();
    if (reportType === '4am') {
      if (report4amEmail && sesFromEmail) {
        try {
          const ses = new SESClient({ region: 'us-east-1' });
          const subject = 'Lake Louise 04:00 Report — ' + new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: 'short', day: 'numeric' });
          const emailHtml = makeEmailSafe(html);
          await ses.send(new SendEmailCommand({
            Source: sesFromEmail,
            Destination: { ToAddresses: [report4amEmail] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Html: { Data: emailHtml, Charset: 'UTF-8' } }
            }
          }));
          console.log('4am report email sent to', report4amEmail);
        } catch (err) {
          console.error('Failed to send 4am report email:', err.message || err);
        }
      } else {
        console.log('4am report: email skipped (set REPORT_4AM_EMAIL and SES_FROM_EMAIL in .env to send).');
      }
    }

    // Write cache: per-source timestamps (and resortHash for change detection).
    const now = new Date().toISOString();
    const nextCache = {
      version: CACHE_VERSION,
      weatherLinkAt: needWeatherLink ? now : (cache.weatherLinkAt || now),
      weatherLinkData,
      waterAt: needWater ? now : (cache.waterAt || now),
      waterData,
      pikaSkokiAt: needPikaSkoki ? now : (cache.pikaSkokiAt || now),
      pikaData,
      skokiData,
      modelsAt: needModels ? now : (cache.modelsAt || now),
      forecastTimeline,
      detailedForecast: liveDetailedForecast ?? detailedForecast ?? null,
      townsiteAt: needTownsite ? now : (cache.townsiteAt || now),
      townsiteData,
      resortAt: needResort ? now : (cache.resortAt || now),
      resortData,
      resortHash: resortData?.xmlHash ?? cache.resortHash
    };
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(nextCache, null, 2), 'utf8');
      const fetched = [needWeatherLink && 'WeatherLink', needWater && 'Water', needPikaSkoki && 'PikaSkoki', needModels && 'Models', needTownsite && 'Townsite', needResort && 'Resort'].filter(Boolean);
      if (fetched.length) {
        console.log('Updated cache for: ' + fetched.join(', ') + '.');
      } else {
        console.log('Cache unchanged (all sources fresh).');
      }
    } catch (e) {
      console.warn('Could not write dry-run cache:', e.message);
    }
    if (needModels && (liveDetailedForecast != null || (forecastTimeline && forecastTimeline.length > 0))) {
      const cachePath = path.join(__dirname, 'fixtures', 'cached-forecast.json');
      try {
        fs.writeFileSync(cachePath, JSON.stringify({
          cachedAt: now,
          detailedForecast: liveDetailedForecast ?? null,
          forecastTimeline: forecastTimeline ?? []
        }, null, 2), 'utf8');
        console.log('Cached NOAA forecast to fixtures/cached-forecast.json');
      } catch (e) {
        console.warn('Could not write cached-forecast:', e.message);
      }
    }
  } catch (err) {
    console.error('Error in dry render:', err);
    process.exit(1);
  }
})();

