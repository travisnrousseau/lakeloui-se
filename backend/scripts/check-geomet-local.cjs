#!/usr/bin/env node
/**
 * Fetch GeoMet base/summit temps (Lake Louise) and print locally.
 * Uses WMS GetFeatureInfo first, then WCS+netCDF fallback.
 *
 * From backend directory:
 *   npm run check-geomet
 *
 * Requires build first (npm run build).
 */
const path = require("path");
const backendDir = path.join(__dirname, "..");
const { getHrdpsTemp2m, getRdpsTemp2m, getRdpsPblHeightM, getGdpsTemp2m, COORDS } = require(path.join(backendDir, "dist", "geometClient.cjs"));
const { lapseCorrectFromRefWithPbl } = require(path.join(backendDir, "dist", "geometForecast.cjs"));
const { getSummitPointForTemp } = require(path.join(backendDir, "dist", "elevation.cjs"));

function fmt(t) {
  if (t == null || !Number.isFinite(t)) return "—";
  return `${t.toFixed(1)}°C`;
}

async function main() {
  console.log("GeoMet Lake Louise — Base / Summit (WMS first, WCS fallback)\n");
  console.log("Location:  Base   ", COORDS.BASE.lat.toFixed(4), COORDS.BASE.lon.toFixed(4), `(${COORDS.BASE.elevM} m)`);

  const summitPoint = await getSummitPointForTemp(
    { lat: COORDS.PARADISE.lat, lon: COORDS.PARADISE.lon },
    COORDS.PARADISE.elevM
  );
  console.log("          Summit ", summitPoint.lat.toFixed(4), summitPoint.lon.toFixed(4), `(${Math.round(summitPoint.elevM)} m, elevation-optimized)\n`);

  const LAPSE_RATE_PER_M = 0.0065;
  const lapseCorrectBase = (tempSummit, elevSummitM, elevBaseM) =>
    tempSummit + (elevSummitM - elevBaseM) * LAPSE_RATE_PER_M;
  const RDPS_REF_ELEV_M = 2071;

  const [hrdpsBase, hrdpsSummit, rdpsAtRef, rdpsPblHeight, gdpsSummit] = await Promise.all([
    getHrdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon),
    getHrdpsTemp2m(summitPoint.lat, summitPoint.lon),
    getRdpsTemp2m(COORDS.BASE.lat, COORDS.BASE.lon),
    getRdpsPblHeightM(COORDS.BASE.lat, COORDS.BASE.lon),
    getGdpsTemp2m(summitPoint.lat, summitPoint.lon),
  ]);
  const gdpsBase =
    gdpsSummit != null && Number.isFinite(gdpsSummit)
      ? lapseCorrectBase(gdpsSummit, COORDS.PARADISE.elevM, COORDS.BASE.elevM)
      : null;
  const rdpsCorrected =
    rdpsAtRef != null && Number.isFinite(rdpsAtRef)
      ? lapseCorrectFromRefWithPbl(rdpsAtRef, RDPS_REF_ELEV_M, COORDS.BASE.elevM, COORDS.PARADISE.elevM, rdpsPblHeight)
      : null;

  const pblNote = rdpsPblHeight != null ? `PBL ${Math.round(rdpsPblHeight)} m` : "PBL —";

  console.log("Model     Base       Summit");
  console.log("------    ---------- ----------");
  console.log("HRDPS     ", fmt(hrdpsBase).padEnd(10), " ", fmt(hrdpsSummit), "  (6–24h)");
  console.log("RDPS      ", fmt(rdpsCorrected?.baseTemp).padEnd(10), " ", fmt(rdpsCorrected?.summitTemp), "  (PBL-aware, ", pblNote, ")");
  console.log("GDPS      ", fmt(gdpsBase).padEnd(10), " ", fmt(gdpsSummit), "  (36–48h, base lapse-corrected from summit)");
  console.log("");

  const any = [hrdpsBase, hrdpsSummit, gdpsBase, gdpsSummit, rdpsCorrected?.baseTemp, rdpsCorrected?.summitTemp].some((v) => v != null && Number.isFinite(v));
  if (!any) {
    console.error("No GeoMet data. See docs/MODEL_AVAILABILITY.md.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
