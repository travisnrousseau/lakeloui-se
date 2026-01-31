#!/usr/bin/env node
/**
 * List GeoMet WMS layers that contain "wind" (and optionally 80m, 120m, 10m)
 * to find elevated wind layers for HRDPS/RDPS.
 *
 * From backend: node scripts/list-geomet-wind-layers.mjs
 */

const GEOMET_BASE = "https://geo.weather.gc.ca/geomet";

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function extractWmsLayerNames(xml) {
  const names = new Set();
  const re = /<Name>([^<]+)<\/Name>/g;
  let m;
  while ((m = re.exec(xml)) !== null) names.add(m[1].trim());
  return [...names];
}

async function main() {
  console.log("GeoMet wind layer discovery (HRDPS, RDPS, 10m, 80m, 120m)\n");

  const wmsUrl = `${GEOMET_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;
  let wmsNames = [];
  try {
    console.log("Fetching WMS GetCapabilities...");
    const wmsXml = await fetchText(wmsUrl);
    wmsNames = extractWmsLayerNames(wmsXml);
    console.log(`  Found ${wmsNames.length} layer names.\n`);
  } catch (e) {
    console.error("WMS error:", e.message);
    process.exit(1);
  }

  const windLayers = wmsNames.filter((n) => /wind/i.test(n));
  console.log("--- All layers containing 'wind' ---");
  for (const name of windLayers.sort()) {
    const tags = [];
    if (/10m|10 m|10_m/i.test(name)) tags.push("10m");
    if (/80m|80 m|80_m|80m/i.test(name)) tags.push("80m");
    if (/120m|120 m|120_m/i.test(name)) tags.push("120m");
    if (/hrdps/i.test(name)) tags.push("HRDPS");
    if (/rdps/i.test(name)) tags.push("RDPS");
    if (/gdps/i.test(name)) tags.push("GDPS");
    console.log(`  ${name}${tags.length ? `  [${tags.join(", ")}]` : ""}`);
  }

  const hrdpsWind = windLayers.filter((n) => /hrdps.*wind|wind.*hrdps/i.test(n));
  const rdpsWind = windLayers.filter((n) => /rdps.*wind|wind.*rdps/i.test(n));
  const elevated = windLayers.filter((n) => /80m|120m|100m|80 m|120 m/i.test(n));

  console.log("\n--- HRDPS wind layers ---");
  console.log(hrdpsWind.length ? hrdpsWind.sort().join("\n  ") : "(none)");
  console.log("\n--- RDPS wind layers ---");
  console.log(rdpsWind.length ? rdpsWind.sort().join("\n  ") : "(none)");
  console.log("\n--- Elevated wind (80m, 100m, 120m) ---");
  console.log(elevated.length ? elevated.sort().join("\n  ") : "(none)");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
