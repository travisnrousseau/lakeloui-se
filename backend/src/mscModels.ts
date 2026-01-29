import axios from "axios";
import { decode as decodeJpeg2000 } from "@abasb75/jpeg2000-decoder";
// @ts-ignore
import { GRIB } from "vgrib2";

/**
 * MSC (Meteorological Service of Canada) GRIB2 Clipping Logic
 * Supports HRDPS, RDPS, GDPS, and FireWork.
 * Stations include elevation (m) for context; 2 m temperature gives model value at station location.
 */

const COORDS = {
  BASE: { lat: 51.443204, lon: -116.161562, elevM: 1650 },
  PARADISE: { lat: 51.460321, lon: -116.131901, elevM: 2630 },
  PIKA: { lat: 51.462086, lon: -116.119943, elevM: 2000 },
  SKOKI: { lat: 51.541860, lon: -116.043900, elevM: 2040 },
};

const URLS = {
  /** HRDPS Continental 2.5km — pan-Canada, runs 00/06/12/18 UTC, 48h. dd.weather.gc.ca or dd.meteo.gc.ca */
  HRDPS: "https://dd.meteo.gc.ca/model_hrdps/continental/2.5km",
  /** HRDPS 1km West — BC + W.Alberta (includes Lake Louise), runs 00/12 UTC only, 48h. DD-Alpha. */
  HRDPS_WEST_1KM: "https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2",
  /** RDPS polar stereo: CMC_reg_..._ps10km (readme_rdps-datamart). */
  RDPS: "https://dd.meteo.gc.ca/model_gem_regional/10km/grib2",
  /** GDPS lat_lon, CMC_glb file naming. */
  GDPS: "https://dd.meteo.gc.ca/model_gem_global/15km/grib2/lat_lon",
  FIREWORK: "https://dd.weather.gc.ca/model_firework/continental/2.5km/grib2",
};

export interface PointData {
  temp850?: number;
  temp700?: number;
  /** 2 m above ground (model at station location; compare to WeatherLink) */
  temp2m?: number;
  windSpeed700?: number;
  windDir700?: number;
  humidity700?: number;
  pm25?: number; // For FireWork
}

export interface ModelResultSet {
  [key: string]: PointData | string;
  timestamp: string;
}

/**
 * Finds the latest available model run for a given interval (6h for RDPS, 12h for GDPS).
 */
function getLatestModelRun(intervalHours: number = 6): { date: string; run: string } {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const dateStr = now.toISOString().split("T")[0].replace(/-/g, "");
  
  const runs = Array.from({ length: 24 / intervalHours }, (_, i) => (i * intervalHours).toString().padStart(2, "0")).reverse();
  
  for (const run of runs) {
    if (utcHour >= parseInt(run) + 4) { // 4h delay for processing
      return { date: dateStr, run };
    }
  }

  // If no run found today yet, go to yesterday's last run
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  return { 
    date: yesterday.toISOString().split("T")[0].replace(/-/g, ""), 
    run: runs[0]
  };
}

/**
 * Latest HRDPS run that West 1km actually has (00 or 12 only). Use this for HRDPS so we always hit West.
 */
function getLatestHrdpsRun(): { date: string; run: string } {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const dateStr = now.toISOString().split("T")[0].replace(/-/g, "");
  // West 1km: 12Z available after ~16 UTC, 00Z after ~4 UTC
  // It is currently 06:30 UTC. If 00Z is still 404, we need more delay.
  if (utcHour >= 18) return { date: dateStr, run: "12" };
  if (utcHour >= 6) return { date: dateStr, run: "00" };
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  if (utcHour >= 18 - 24 + 24) { /* logic is getting messy, let's simplify */ }
  
  // Simple logic: 
  // 00Z is usually ready by 05:00 UTC.
  // 12Z is usually ready by 17:00 UTC.
  if (utcHour >= 17) return { date: dateStr, run: "12" };
  if (utcHour >= 5) return { date: dateStr, run: "00" };
  
  // Fallback to previous run
  const yesterdayDateStr = new Date(now.getTime() - 24*60*60*1000).toISOString().split("T")[0].replace(/-/g, "");
  return { date: yesterdayDateStr, run: "12" };
}

/** Match a line for variable/level. Level can be "2 m", "2m", "above ground", "AGL" for 2m temp. */
function idxLineMatches(line: string, variable: string, level: string): boolean {
  if (!line.includes(variable)) return false;
  const levelNorm = level.toLowerCase().replace(/\s+/g, " ");
  const altLevels = [levelNorm, level.replace(/\s/g, ""), "above ground", "agl", "2 m", "2m"];
  return altLevels.some((alt) => line.toLowerCase().includes(alt));
}

/** ECCC isobaric level in filename: "850 mb" -> "0850", "700 mb" -> "0700" (4-digit hPa). */
function isobaricLevelTag(level: string): string {
  const match = level.match(/(\d+)\s*mb/i);
  if (match) return String(parseInt(match[1], 10)).padStart(4, "0");
  return level.replace(/\s/g, "_");
}

/** Parse byte offset from wgrib2-style .idx line: "rec:byte_offset:key" or "byte_offset:key". */
function byteOffsetFromIdxLine(line: string): number {
  const parts = line.split(":");
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  if (!Number.isNaN(b)) return b; // wgrib2: second field is byte_offset
  if (!Number.isNaN(a)) return a; // some idx: first field is byte_offset
  return -1;
}

let firstForecastFailureLogged = false;

/** Fetch one GRIB2 message. Prefer byte-range via .idx; if .idx 404, fetch full file (ECCC single-message). */
async function fetchGribMessage(url: string, variable: string, level: string): Promise<Buffer | null> {
  try {
    const idxUrl = `${url}.idx`;
    const idxResponse = await axios.get(idxUrl, { timeout: 60_000 });
    const idxLines = idxResponse.data.split("\n");

    let startByte = -1;
    let endByte = -1;

    for (let i = 0; i < idxLines.length; i++) {
      if (idxLineMatches(idxLines[i], variable, level)) {
        startByte = byteOffsetFromIdxLine(idxLines[i]);
        if (i + 1 < idxLines.length) {
          const nextByte = byteOffsetFromIdxLine(idxLines[i + 1]);
          endByte = nextByte >= 0 ? nextByte - 1 : -1;
        }
        break;
      }
    }

    if (startByte === -1) {
      if (!firstForecastFailureLogged) {
        firstForecastFailureLogged = true;
        console.warn(`Forecast first failure (idx no match): ${variable}/${level} idx=${idxUrl} sample_line=${idxLines[0] ?? "none"}`);
      }
      return null;
    }

    const rangeEnd = endByte >= 0 ? endByte : "";
    const response = await axios.get(url, {
      headers: { Range: `bytes=${startByte}-${rangeEnd}` },
      responseType: "arraybuffer",
      timeout: 60_000,
    });

    return Buffer.from(response.data);
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 404) {
      try {
        const full = await axios.get(url, { responseType: "arraybuffer", timeout: 90_000 });
        return Buffer.from(full.data);
      } catch (fullErr: any) {
        const altUrl = url.replace("dd.weather.gc.ca", "dd.meteo.gc.ca");
        if (altUrl !== url) {
          try {
            const full = await axios.get(altUrl, { responseType: "arraybuffer", timeout: 90_000 });
            return Buffer.from(full.data);
          } catch (_) {}
        }
        if (!firstForecastFailureLogged) {
          firstForecastFailureLogged = true;
          console.warn(`Forecast first failure (full fallback): ${url} err=${fullErr?.message ?? String(fullErr)}`);
        }
        return null;
      }
    }
    if (!firstForecastFailureLogged) {
      firstForecastFailureLogged = true;
      console.warn(`Forecast first failure (fetch): ${url} err=${error?.message ?? String(error)}`);
    }
    return null;
  }
}

/** Geographic (lat, lon) in degrees to rotated (Template 3.1) using south pole (LaD, LoV) in degrees. Returns degrees. */
function geographicToRotated(latDeg: number, lonDeg: number, LaD: number, LoV: number): { lat: number; lon: number } {
  const toRad = Math.PI / 180;
  
  // ECCC HRDPS West 1km transformation
  // LaD and LoV are the coordinates of the SOUTHERN POLE of the rotated grid.
  // For HRDPS West 1km: LaD = 31.7583, LoV = -114.092
  
  const lat = latDeg * toRad;
  const lon = lonDeg * toRad;
  const spLat = LaD * toRad;
  const spLon = LoV * toRad;

  // 1. Shift longitude so that the southern pole is at lon = 0
  const lonShifted = lon - spLon;
  
  // 2. Standard rotation formula
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinSpLat = Math.sin(spLat);
  const cosSpLat = Math.cos(spLat);
  const sinLon = Math.sin(lonShifted);
  const cosLon = Math.cos(lonShifted);

  // Rotated latitude
  const latRot = Math.asin(sinSpLat * sinLat + cosSpLat * cosLat * cosLon);
  
  // Rotated longitude
  const lonRot = Math.atan2(cosLat * sinLon, sinSpLat * cosLat * cosLon - cosSpLat * sinLat);

  let latRotDeg = (latRot * 180) / Math.PI;
  let lonRotDeg = (lonRot * 180) / Math.PI;

  // HRDPS West 1km grid is usually defined with la1/lo1 in rotated coordinates.
  // The grid lo1 is 337.819... which is -22.18 degrees.
  // We need to ensure lonRotDeg is in the same range [0, 360] if needed.
  if (lonRotDeg < 0) lonRotDeg += 360;
  
  return { lat: latRotDeg, lon: lonRotDeg };
}

/** Decode GRIB2 Template 5.40 (JPEG2000) Section 7 and apply scale factors to get number[]. */
async function decodeJpeg2000GribData(
  rawData: Buffer,
  dataRepresentation: { referenceValue: number; binaryScaleFactor: number; decimalScaleFactor: number }
): Promise<number[]> {
  const inputAb = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) as ArrayBuffer;
  const decoded = await decodeJpeg2000(inputAb);
  const { decodedBuffer, frameInfo } = decoded;
  
  const R = dataRepresentation.referenceValue;
  const E = dataRepresentation.binaryScaleFactor;
  const D = dataRepresentation.decimalScaleFactor;
  const DD = Math.pow(10, D);
  const EE = Math.pow(2, E);
  
  console.log("Data Representation:", { R, E, D, DD, EE, bits: frameInfo.bitsPerSample });

  const view = new Uint8Array(decodedBuffer as ArrayBufferLike);
  const outAb = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  const bits = frameInfo.bitsPerSample ?? 8;
  const n = outAb.byteLength / (bits <= 8 ? 1 : 2);
  const values: number[] = [];
  
  if (bits <= 8) {
    const arr = new Uint8Array(outAb);
    for (let i = 0; i < n; i++) values.push((R + arr[i] * EE) / DD);
  } else {
    const arr = new Uint16Array(outAb);
    for (let i = 0; i < n; i++) values.push((R + arr[i] * EE) / DD);
  }
  return values;
}

/**
 * Extract value at (lat, lon) from GRIB2 using grid definition (template 3.0 or 3.1).
 * For Template 3.1 (rotated lat/lon), converts geographic to rotated coords first.
 * For Template 5.40 (JPEG2000), decodes Section 7 async and applies scale factors.
 * Nearest-grid-point; no bilinear interpolation.
 */
async function extractValueForCoord(buffer: Buffer, lat: number, lon: number): Promise<number> {
  const grib = GRIB.parseNoLookup(buffer as unknown as ArrayBuffer);
  const msg = grib[0];
  let data: number[] = Array.isArray(msg.data) ? msg.data : [];
  const grid = msg.gridDefinition as any;
  const dataRep = msg.dataRepresentation as { referenceValue: number; binaryScaleFactor: number; decimalScaleFactor: number } | undefined;

  if ((Buffer.isBuffer(msg.data) || msg.data instanceof Uint8Array) && dataRep) {
    data = await decodeJpeg2000GribData(Buffer.from(msg.data), dataRep);
  }

  if (!grid || !Array.isArray(data) || data.length === 0) return data[0] ?? 0;

  let latG = lat;
  let lonG = lon;
  if (grid.LaD != null && grid.LoV != null) {
    const rot = geographicToRotated(lat, lon, grid.LaD, grid.LoV);
    latG = rot.lat;
    lonG = rot.lon;
  }

  const { la1, lo1, dx, dy, nx, ny } = grid;
  const j = Math.max(0, Math.min(ny - 1, Math.round((latG - la1) / dy)));
  const i = Math.max(0, Math.min(nx - 1, Math.round((lonG - lo1) / dx)));
  const index = j * nx + i;
  
  if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
    console.warn("Grid Lookup at EDGE:", { latG, lonG, i, j, nx, ny, la1, lo1 });
  }

  return data[index] ?? data[0] ?? 0;
}

/** RDPS polar stereo file naming: CMC_reg_{VAR}_{LEVEL}_ps10km_{YYYYMMDDHH}_P{hhh}.grib2 */
function rdpsFileName(date: string, run: string, leadStr: string, variable: string, level: string): string {
  const dateRun = `${date}${run}`;
  return `CMC_reg_${variable}_${level}_ps10km_${dateRun}_P${leadStr}.grib2`;
}

/**
 * Fetches data for a specific model.
 */
async function fetchModel(modelType: keyof typeof URLS): Promise<ModelResultSet | null> {
  const interval = modelType === "GDPS" ? 12 : 6;
  const { date, run } = modelType === "HRDPS" ? getLatestHrdpsRun() : getLatestModelRun(interval);
  const forecastHour = "001";
  
  const vars = [
    { name: "TMP", level: "850 mb", key: "tmp850" },
    { name: "TMP", level: "700 mb", key: "tmp700" },
    { name: "UGRD", level: "700 mb", key: "ugrd700" },
    { name: "VGRD", level: "700 mb", key: "vgrd700" },
    { name: "SPFH", level: "700 mb", key: "spfh700" },
  ];

  if (modelType === "FIREWORK") {
    vars.push({ name: "PM2.5", level: "surface", key: "pm25" });
  }

  const buffers: Record<string, Buffer | null> = {};

  if (modelType === "HRDPS") {
    // Try West 1km first (run 00/12), then Continental; West uses different file naming on dd.alpha.
    const bases = hrdpsBaseUrls(run);
    for (const base of bases) {
      const baseUrl = `${base}/${run}/${forecastHour}`;
      const west = isHrdpsWest(base);
      if (west) {
        await Promise.all(
          vars.map(async (v) => {
            const fn = westHrdpsFileName(date, run, forecastHour, v.name, v.level);
            buffers[v.key] = await fetchGribMessage(`${baseUrl}/${fn}`, v.name, v.level);
          })
        );
        buffers.tmp2m = await fetchGribMessage(
          `${baseUrl}/${westHrdpsFileName(date, run, forecastHour, "TMP", "2 m")}`,
          "TMP",
          "2 m"
        );
      } else {
        const fileNamePrefix = `${date}T${run}Z_MSC_HRDPS`;
        const gridSuffix = "RLatLon0.0225_PT001H.grib2";
        await Promise.all(
          vars.map(async (v) => {
            const levelTag = v.level.toLowerCase().includes("mb") ? isobaricLevelTag(v.level) : v.level.replace(/\s/g, "_");
            const url = `${baseUrl}/${fileNamePrefix}_${v.name}_ISBL_${levelTag}_${gridSuffix}`;
            buffers[v.key] = await fetchGribMessage(url, v.name, v.level);
          })
        );
        buffers.tmp2m = await fetchGribMessage(`${baseUrl}/${fileNamePrefix}_TMP_AGL-2m_${gridSuffix}`, "TMP", "2 m");
      }
      if (buffers.tmp850) break;
    }
  } else {
    const baseUrl = `${URLS[modelType]}/${run}/${forecastHour}`;
    let fileNamePrefix = "";
    let gridSuffix = "";

    if (modelType === "RDPS") {
      fileNamePrefix = `${date}T${run}Z_MSC_RDPS`;
      gridSuffix = "LatLon0.1_PT001H.grib2";
    } else if (modelType === "GDPS") {
      fileNamePrefix = `${date}T${run}Z_MSC_GDPS`;
      gridSuffix = "LatLon0.15_PT003H.grib2";
    } else if (modelType === "FIREWORK") {
      fileNamePrefix = `${date}T${run}Z_MSC_FIREWORK`;
      gridSuffix = "RLatLon0.0225_PT001H.grib2";
    }

    if (modelType === "RDPS") {
      await Promise.all([
        fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, forecastHour, "TMP", "ISBL_0850")}`, "TMP", "850 mb").then((b) => { buffers.tmp850 = b; }),
        fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, forecastHour, "TMP", "ISBL_0700")}`, "TMP", "700 mb").then((b) => { buffers.tmp700 = b; }),
        fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, forecastHour, "UGRD", "ISBL_0700")}`, "UGRD", "700 mb").then((b) => { buffers.ugrd700 = b; }),
        fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, forecastHour, "VGRD", "ISBL_0700")}`, "VGRD", "700 mb").then((b) => { buffers.vgrd700 = b; }),
        fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, forecastHour, "SPFH", "ISBL_0700")}`, "SPFH", "700 mb").then((b) => { buffers.spfh700 = b; }),
      ]);
      buffers.tmp2m = await fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, forecastHour, "TMP", "TGL_2")}`, "TMP", "2 m");
    } else {
      await Promise.all(
        vars.map(async (v) => {
          const levelTag = v.level.toLowerCase().includes("mb") ? isobaricLevelTag(v.level) : v.level.replace(/\s/g, "_");
          const url = `${baseUrl}/${fileNamePrefix}_${v.name}_ISBL_${levelTag}_${gridSuffix}`;
          buffers[v.key] = await fetchGribMessage(url, v.name, v.level);
        })
      );
      const url2m = `${baseUrl}/${fileNamePrefix}_TMP_AGL-2m_${gridSuffix}`;
      buffers.tmp2m = await fetchGribMessage(url2m, "TMP", "2 m");
    }
  }

  if (!buffers.tmp850 && modelType !== "FIREWORK") return null;

  const results: any = {
    timestamp: new Date().toISOString()
  };

  for (const [coordName, coord] of Object.entries(COORDS)) {
    const data: PointData = {};
    if (buffers.tmp850) data.temp850 = (await extractValueForCoord(buffers.tmp850, coord.lat, coord.lon)) - 273.15;
    if (buffers.tmp700) data.temp700 = (await extractValueForCoord(buffers.tmp700, coord.lat, coord.lon)) - 273.15;
    if (buffers.tmp2m) data.temp2m = (await extractValueForCoord(buffers.tmp2m, coord.lat, coord.lon)) - 273.15;
    if (buffers.ugrd700 && buffers.vgrd700) {
      const u = await extractValueForCoord(buffers.ugrd700, coord.lat, coord.lon);
      const v = await extractValueForCoord(buffers.vgrd700, coord.lat, coord.lon);
      data.windSpeed700 = Math.sqrt(u * u + v * v) * 3.6;
      data.windDir700 = (Math.atan2(u, v) * 180 / Math.PI + 180) % 360;
    }
    if (buffers.spfh700) data.humidity700 = await extractValueForCoord(buffers.spfh700, coord.lat, coord.lon);
    if (buffers.pm25) data.pm25 = await extractValueForCoord(buffers.pm25, coord.lat, coord.lon);
    results[coordName] = data;
  }

  return results;
}

export async function fetchAllMscData(): Promise<Record<string, ModelResultSet | null>> {
  const [hrdps, rdps, gdps, firework] = await Promise.all([
    fetchModel("HRDPS"),
    fetchModel("RDPS"),
    fetchModel("GDPS"),
    fetchModel("FIREWORK"),
  ]);

  return { hrdps, rdps, gdps, firework };
}

export interface DetailedForecast {
  hrdps: ForecastPeriod[];
  rdps: ForecastPeriod[];
  gdpsTrend: string;
  verticalProfile: { level: number; temp: number }[];
  pm25: number | null;
}

/** Forecast period: one row in the consensus timeline (Lake Louise area). */
export interface ForecastPeriod {
  leadHours: number;
  label: string;
  tempBase: number | null;
  tempSummit: number | null;
  windSpeed: number | null;
  windDir: number | null;
  source: "HRDPS" | "RDPS" | "GDPS";
}

/** Grid suffix for a given lead time (PT006H, PT024H, etc.). GDPS uses 3h steps. */
function gridSuffixForLead(modelType: keyof typeof URLS, leadHours: number): string {
  if (modelType === "GDPS") {
    const step = Math.round(leadHours / 3) * 3;
    return `LatLon0.15_PT${String(step).padStart(3, "0")}H.grib2`;
  }
  if (modelType === "HRDPS") return `RLatLon0.0225_PT${String(leadHours).padStart(3, "0")}H.grib2`;
  if (modelType === "RDPS") return `LatLon0.1_PT${String(leadHours).padStart(3, "0")}H.grib2`;
  return `RLatLon0.0225_PT${String(leadHours).padStart(3, "0")}H.grib2`;
}

/** GDPS file naming: CMC_glb_Variable_Level_ProjectionResolution_YYYYMMDDHH_Phhh.grib2 */
function gdpsFileName(date: string, run: string, leadHours: number, variable: string, level: string): string {
  const leadStr = String(leadHours).padStart(3, "0");
  const dateRun = `${date}${run}`;
  return `CMC_glb_${variable}_${level}_LatLon0.15_${dateRun}_P${leadStr}.grib2`;
}

/** For HRDPS forecast: try 1km West first when run is 00 or 12 (Lake Louise in domain), else Continental. */
function hrdpsBaseUrls(run: string): string[] {
  if (run === "00" || run === "12") return [URLS.HRDPS_WEST_1KM, URLS.HRDPS];
  return [URLS.HRDPS];
}

/** True if the HRDPS base URL is West 1km (dd.alpha); West uses different file naming. */
function isHrdpsWest(baseUrl: string): boolean {
  return baseUrl.includes("west/1km") || baseUrl.includes("dd.alpha");
}

/**
 * West 1km HRDPS file naming (dd.alpha.weather.gc.ca):
 * CMC_hrdps_west_{VAR}_{LEVEL}_rotated_latlon0.009x0.009_{YYYYMMDD}T{HH}Z_P{lead}-00.grib2
 * e.g. CMC_hrdps_west_TMP_TGL_2_rotated_latlon0.009x0.009_20260128T12Z_P003-00.grib2
 */
function westHrdpsFileName(date: string, run: string, leadStr: string, variable: string, level: string): string {
  const levelTag = level.toLowerCase().includes("2 m") || level.toLowerCase().includes("2m")
    ? "TGL_2"
    : level.toLowerCase().includes("mb")
      ? `ISBL_${isobaricLevelTag(level)}`
      : level.replace(/\s/g, "_");
  return `CMC_hrdps_west_${variable}_${levelTag}_rotated_latlon0.009x0.009_${date}T${run}Z_P${leadStr}-00.grib2`;
}

/** Fetch 2m temp (and 700 mb wind) at one lead time for one model — BASE and PARADISE only. */
async function fetchModelAtLead(
  modelType: "HRDPS" | "RDPS" | "GDPS",
  leadHours: number
): Promise<{ BASE: PointData; PARADISE: PointData } | null> {
  const interval = modelType === "GDPS" ? 12 : 6;
  const { date, run } = modelType === "HRDPS" ? getLatestHrdpsRun() : getLatestModelRun(interval);
  const leadStr = String(leadHours).padStart(3, "0");
  let buf2m: Buffer | null = null;
  let bufU: Buffer | null = null;
  let bufV: Buffer | null = null;

  if (modelType === "GDPS") {
    const baseUrl = `${URLS.GDPS}/${run}/${leadStr}`;
    const step = Math.round(leadHours / 3) * 3;
    buf2m = await fetchGribMessage(`${baseUrl}/${gdpsFileName(date, run, step, "TMP", "AGL-2m")}`, "TMP", "2 m");
    bufU = await fetchGribMessage(`${baseUrl}/${gdpsFileName(date, run, step, "UGRD", "ISBL_0700")}`, "UGRD", "700");
    bufV = await fetchGribMessage(`${baseUrl}/${gdpsFileName(date, run, step, "VGRD", "ISBL_0700")}`, "VGRD", "700");
  } else if (modelType === "RDPS") {
    const baseUrl = `${URLS.RDPS}/${run}/${leadStr}`;
    buf2m = await fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, leadStr, "TMP", "TGL_2")}`, "TMP", "2 m");
    bufU = await fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, leadStr, "UGRD", "ISBL_0700")}`, "UGRD", "700");
    bufV = await fetchGribMessage(`${baseUrl}/${rdpsFileName(date, run, leadStr, "VGRD", "ISBL_0700")}`, "VGRD", "700");
  } else {
    const gridSuffix = gridSuffixForLead("HRDPS", leadHours);
    const fileNamePrefix = `${date}T${run}Z_MSC_HRDPS`;
    for (const base of hrdpsBaseUrls(run)) {
      const baseUrl = `${base}/${run}/${leadStr}`;
      if (isHrdpsWest(base)) {
        buf2m = await fetchGribMessage(`${baseUrl}/${westHrdpsFileName(date, run, leadStr, "TMP", "2 m")}`, "TMP", "2 m");
        if (buf2m) {
          bufU = await fetchGribMessage(`${baseUrl}/${westHrdpsFileName(date, run, leadStr, "UGRD", "700 mb")}`, "UGRD", "700");
          bufV = await fetchGribMessage(`${baseUrl}/${westHrdpsFileName(date, run, leadStr, "VGRD", "700 mb")}`, "VGRD", "700");
          break;
        }
      } else {
        buf2m = await fetchGribMessage(`${baseUrl}/${fileNamePrefix}_TMP_AGL-2m_${gridSuffix}`, "TMP", "2 m");
        if (buf2m) {
          bufU = await fetchGribMessage(`${baseUrl}/${fileNamePrefix}_UGRD_ISBL_0700_${gridSuffix}`, "UGRD", "700");
          bufV = await fetchGribMessage(`${baseUrl}/${fileNamePrefix}_VGRD_ISBL_0700_${gridSuffix}`, "VGRD", "700");
          break;
        }
      }
    }
  }

  if (!buf2m) {
    if (process.env.DEBUG_FORECAST) console.warn(`Forecast no 2m data: ${modelType} lead ${leadHours}h`);
    return null;
  }

  const base = COORDS.BASE;
  const par = COORDS.PARADISE;
  const tempBase = (await extractValueForCoord(buf2m, base.lat, base.lon)) - 273.15;
  const tempSummit = (await extractValueForCoord(buf2m, par.lat, par.lon)) - 273.15;
  let windSpeed: number | null = null;
  let windDir: number | null = null;
  if (bufU && bufV) {
    const u = ((await extractValueForCoord(bufU, base.lat, base.lon)) + (await extractValueForCoord(bufU, par.lat, par.lon))) / 2;
    const v = ((await extractValueForCoord(bufV, base.lat, base.lon)) + (await extractValueForCoord(bufV, par.lat, par.lon))) / 2;
    windSpeed = Math.sqrt(u * u + v * v) * 3.6;
    windDir = (Math.atan2(u, v) * 180 / Math.PI + 180) % 360;
  }

  return {
    BASE: { temp2m: tempBase, windSpeed700: windSpeed ?? undefined, windDir700: windDir ?? undefined },
    PARADISE: { temp2m: tempSummit, windSpeed700: windSpeed ?? undefined, windDir700: windDir ?? undefined },
  };
}

/** Human-readable label for a lead time (MST). */
function labelForLeadHours(leadHours: number): string {
  const now = new Date();
  const t = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
  const mst = new Date(t.toLocaleString("en-US", { timeZone: "America/Edmonton" }));
  const hour = mst.getHours();
  const day = mst.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Edmonton" });
  if (hour >= 0 && hour < 6) return `${day} night`;
  if (hour >= 6 && hour < 12) return `${day} AM`;
  if (hour >= 12 && hour < 18) return `${day} PM`;
  return `${day} eve`;
}

/** Fetch vertical temperature profile from HRDPS at 001h lead. */
async function fetchVerticalProfile(): Promise<{ level: number; temp: number }[]> {
  const { date, run } = getLatestHrdpsRun();
  const levels = [1000, 925, 850, 700, 500];
  const baseUrl = `${URLS.HRDPS}/${run}/001`;
  const fileNamePrefix = `${date}T${run}Z_MSC_HRDPS`;
  const gridSuffix = "RLatLon0.0225_PT001H.grib2";
  const coord = COORDS.BASE;

  const profile = await Promise.all(levels.map(async (lvl) => {
    const levelTag = String(lvl).padStart(4, "0");
    const url = `${baseUrl}/${fileNamePrefix}_TMP_ISBL_${levelTag}_${gridSuffix}`;
    const buf = await fetchGribMessage(url, "TMP", `${lvl} mb`);
    if (!buf) return null;
    const temp = (await extractValueForCoord(buf, coord.lat, coord.lon)) - 273.15;
    return { level: lvl, temp };
  }));

  return profile.filter((p): p is { level: number; temp: number } => p !== null);
}

/** Fetch FireWork PM2.5 at surface for Lake Louise. */
async function fetchFireWorkPM25(): Promise<number | null> {
  const { date, run } = getLatestModelRun(6);
  const baseUrl = `${URLS.FIREWORK}/${run}/001`;
  const fileNamePrefix = `${date}T${run}Z_MSC_FIREWORK`;
  const gridSuffix = "RLatLon0.0225_PT001H.grib2";
  const url = `${baseUrl}/${fileNamePrefix}_PM2.5_ISBL_surface_${gridSuffix}`;
  const buf = await fetchGribMessage(url, "PM2.5", "surface");
  if (!buf) return null;
  return await extractValueForCoord(buf, COORDS.BASE.lat, COORDS.BASE.lon);
}

/** Generate a trend string from GDPS long-range data. */
function generateGdpsTrend(periods: ForecastPeriod[]): string {
  if (periods.length === 0) return "Long-range trend: Data unavailable.";
  const last = periods[periods.length - 1];
  const first = periods[0];
  const tempDiff = (last.tempBase ?? 0) - (first.tempBase ?? 0);
  
  let trend = "Stable conditions expected.";
  if (tempDiff > 5) trend = "Warming trend likely for the weekend.";
  else if (tempDiff < -5) trend = "Cold Arctic air likely to settle in.";
  
  const avgWind = periods.reduce((acc, p) => acc + (p.windSpeed ?? 0), 0) / periods.length;
  if (avgWind > 30) trend += " High-pressure ridge building with active winds.";
  else trend += " Dry, high-pressure ridge building.";

  return `Long-range (7-day) trend: ${trend}`;
}

/**
 * Detailed forecast for Lake Louise: HRDPS, RDPS, GDPS, and FireWork.
 */
export async function fetchDetailedForecast(): Promise<DetailedForecast> {
  const leads = [3, 6, 12, 18, 24, 36, 48];
  const leadsLong = [72, 96, 120, 144, 168];

  const [hrdpsResults, rdpsResults, gdpsResults, verticalProfile, pm25] = await Promise.all([
    Promise.all(leads.map(h => fetchModelAtLead("HRDPS", h))),
    Promise.all(leads.map(h => fetchModelAtLead("RDPS", h))),
    Promise.all(leadsLong.map(h => fetchModelAtLead("GDPS", h))),
    fetchVerticalProfile(),
    fetchFireWorkPM25()
  ]);

  const mapToPeriod = (data: any, h: number, model: any): ForecastPeriod => ({
    leadHours: h,
    label: labelForLeadHours(h),
    tempBase: data?.BASE.temp2m ?? null,
    tempSummit: data?.PARADISE.temp2m ?? null,
    windSpeed: data?.BASE.windSpeed700 ?? null,
    windDir: data?.BASE.windDir700 ?? null,
    source: model
  });

  const hrdps = hrdpsResults.map((d, i) => mapToPeriod(d, leads[i], "HRDPS"));
  const rdps = rdpsResults.map((d, i) => mapToPeriod(d, leads[i], "RDPS"));
  const gdpsLong = gdpsResults.map((d, i) => mapToPeriod(d, leadsLong[i], "GDPS"));

  return {
    hrdps,
    rdps,
    gdpsTrend: generateGdpsTrend(gdpsLong),
    verticalProfile,
    pm25
  };
}

/**
 * Consensus forecast for Lake Louise: HRDPS (0–48h) → RDPS (24–48h) → GDPS (48h and 7-day).
 * Next 48h focus: 3, 6, 12, 18, 24, 36, 48. Next 7 days: 72, 96, 120, 144, 168 (GDPS only).
 * All fetches use byte-range only (never full GRIB2).
 */
export async function fetchForecastTimeline(): Promise<ForecastPeriod[]> {
  const leads48 = [
    { h: 3, model: "HRDPS" as const },
    { h: 6, model: "HRDPS" as const },
    { h: 12, model: "HRDPS" as const },
    { h: 18, model: "HRDPS" as const },
    { h: 24, model: "HRDPS" as const },
    { h: 36, model: "HRDPS" as const },
    { h: 48, model: "HRDPS" as const },
    { h: 24, model: "RDPS" as const },
    { h: 36, model: "RDPS" as const },
    { h: 48, model: "RDPS" as const },
    { h: 48, model: "GDPS" as const },
  ];
  const leads7d = [
    { h: 72, model: "GDPS" as const },
    { h: 96, model: "GDPS" as const },
    { h: 120, model: "GDPS" as const },
    { h: 144, model: "GDPS" as const },
    { h: 168, model: "GDPS" as const },
  ];
  const results = await Promise.all(
    [...leads48, ...leads7d].map(async ({ h, model }) => {
      const data = await fetchModelAtLead(model, h);
      if (!data) return { leadHours: h, model, data: null };
      return { leadHours: h, model, data };
    })
  );

  const byLead: Map<number, ForecastPeriod> = new Map();
  for (const { leadHours: h, model, data } of results) {
    if (!data) continue;
    const existing = byLead.get(h);
    if (h <= 48 && existing && existing.source === "HRDPS" && model !== "HRDPS") continue;
    if (h <= 48 && existing && existing.source === "RDPS" && model === "GDPS") continue;
    if (!existing)
      byLead.set(h, {
        leadHours: h,
        label: labelForLeadHours(h),
        tempBase: data.BASE.temp2m ?? null,
        tempSummit: data.PARADISE.temp2m ?? null,
        windSpeed: data.BASE.windSpeed700 ?? null,
        windDir: data.BASE.windDir700 ?? null,
        source: model,
      });
  }
  const ordered = [3, 6, 12, 18, 24, 36, 48, 72, 96, 120, 144, 168];
  const sorted: ForecastPeriod[] = [];
  for (const h of ordered) {
    const p = byLead.get(h);
    if (p) sorted.push(p);
  }
  return sorted;
}
