#!/usr/bin/env node
/**
 * Debug GeoMet HRDPS/RDPS precipitation: GetCapabilities (time dimension) and
 * one GetFeatureInfo raw response to see layer names and response structure.
 *
 * From backend directory:
 *   node scripts/check-geomet-precip.mjs
 *
 * No build required.
 */

const GEOMET_BASE = "https://geo.weather.gc.ca/geomet";
const LAYERS = {
  "HRDPS (WCS-style)": "HRDPS-WEonG_2.5km_TotalPrecipitation",
  "HRDPS (CONTINENTAL_APCP)": "HRDPS.CONTINENTAL_APCP",
  RDPS: "RDPS.ETA_PR",
};
const COORDS = { BASE: { lat: 51.443204, lon: -116.161562 } };

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/** WMS 1.3.0 GetCapabilities with layer=... to get time dimension. */
async function getLayerTimeDimension(layerName) {
  const url = `${GEOMET_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities&layer=${encodeURIComponent(layerName)}`;
  const xml = await fetchText(url);
  const extMatch = xml.match(/<Extent[^>]*>([^<]+)<\/Extent>/i);
  const dimMatch = xml.match(/<Dimension[^>]*name="time"[^>]*>([^<]*)<\/Dimension>/i);
  const nameMatch = xml.match(new RegExp(`<Name>${layerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</Name>`));
  return {
    layerFound: nameMatch != null,
    extent: extMatch ? extMatch[1].trim() : null,
    dimension: dimMatch ? dimMatch[1].trim() : null,
  };
}

/** WMS GetFeatureInfo at (lat,lon) for one layer and optional TIME. */
async function getFeatureInfo(layerName, lat, lon, time) {
  const bbox = "51, -117, 52, -116";
  const i = Math.round(((lon - (-117)) / (1)) * 99);
  const j = Math.round(((52 - lat) / (1)) * 99);
  const url = new URL(GEOMET_BASE);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetFeatureInfo");
  url.searchParams.set("LAYERS", layerName);
  url.searchParams.set("QUERY_LAYERS", layerName);
  url.searchParams.set("BBOX", bbox);
  if (time) url.searchParams.set("TIME", time);
  url.searchParams.set("I", String(i));
  url.searchParams.set("J", String(j));
  url.searchParams.set("WIDTH", "100");
  url.searchParams.set("HEIGHT", "100");
  url.searchParams.set("INFO_FORMAT", "application/json");
  url.searchParams.set("CRS", "EPSG:4326");
  url.searchParams.set("FEATURE_COUNT", "1");
  return fetchJson(url.toString());
}

function main() {
  return (async () => {
    console.log("GeoMet precipitation debug\n");
    const now = new Date();
    const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(now.getUTCHours() / 6) * 6, 0, 0, 0));
    if (ref.getTime() > now.getTime()) ref.setUTCHours(ref.getUTCHours() - 6);
    const time6h = new Date(ref.getTime() + 6 * 60 * 60 * 1000);
    const timeIso = time6h.toISOString().replace(/\.\d{3}Z$/, "Z");

    for (const [label, layerName] of Object.entries(LAYERS)) {
      console.log(`--- ${label}: ${layerName} ---`);
      try {
        const cap = await getLayerTimeDimension(layerName);
        console.log("  Layer in GetCapabilities:", cap.layerFound ? "yes" : "NO");
        if (cap.dimension) console.log("  Time dimension (first 200 chars):", cap.dimension.slice(0, 200) + (cap.dimension.length > 200 ? "…" : ""));
        else console.log("  Time dimension: (none or not found)");

        const json = await getFeatureInfo(layerName, COORDS.BASE.lat, COORDS.BASE.lon, timeIso);
        console.log("  GetFeatureInfo response (TIME=" + timeIso + "):");
        console.log(JSON.stringify(json, null, 2).split("\n").map((l) => "    " + l).join("\n"));
        const feat = json?.features?.[0];
        const val = feat?.properties?.value ?? json?.value;
        if (val != null && Number.isFinite(val)) console.log("  → Extracted value:", val);
        else console.log("  → No numeric 'value'; keys in features[0].properties:", feat?.properties ? Object.keys(feat.properties).join(", ") : "n/a");
      } catch (e) {
        console.error("  Error:", e.message);
      }
      console.log("");
    }
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
