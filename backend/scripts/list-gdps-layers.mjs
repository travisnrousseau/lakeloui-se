#!/usr/bin/env node
/**
 * List GeoMet WMS layers containing "GDPS" to discover precip/wind layer names.
 * Run from backend: node scripts/list-gdps-layers.mjs
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
  console.log("GeoMet GDPS layer discovery\n");

  const wmsUrl = `${GEOMET_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;
  let wmsNames = [];
  try {
    console.log("Fetching WMS GetCapabilities...");
    const wmsXml = await fetchText(wmsUrl);
    wmsNames = extractWmsLayerNames(wmsXml);
    console.log(`  Total layers: ${wmsNames.length}\n`);
  } catch (e) {
    console.error("WMS error:", e.message);
    process.exit(1);
  }

  const gdps = wmsNames.filter((n) => /gdps/i.test(n)).sort();
  console.log("--- All layers containing 'GDPS' ---");
  for (const name of gdps) {
    const tags = [];
    if (/precip|apcp|pr|rain|snow/i.test(name)) tags.push("precip");
    if (/wind/i.test(name)) tags.push("wind");
    if (/temp|tt|air/i.test(name)) tags.push("temp");
    console.log(`  ${name}${tags.length ? `  [${tags.join(", ")}]` : ""}`);
  }

  const gdpsPrecip = gdps.filter((n) => /precip|apcp|pr/i.test(n) && !/pressure|hpa/i.test(n));
  const gdpsWind = gdps.filter((n) => /wind/i.test(n));
  console.log("\n--- GDPS precip-related ---");
  console.log(gdpsPrecip.length ? gdpsPrecip.join("\n  ") : "(none)");
  console.log("\n--- GDPS wind ---");
  console.log(gdpsWind.length ? gdpsWind.join("\n  ") : "(none)");
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
