#!/usr/bin/env node
/**
 * Query GeoMet WCS and WMS GetCapabilities for layers that might support
 * PBL / vertical profile / inversions (keywords: PBL, height, vertical, level, boundary, profile).
 *
 * From backend directory:
 *   node scripts/list-geomet-pbl-capabilities.mjs
 *
 * No build required. Uses fetch (Node 18+).
 */

const GEOMET_BASE = "https://geo.weather.gc.ca/geomet";
const KEYWORDS = ["pbl", "height", "vertical", "level", "boundary", "profile", "inversion", "elevation"];

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

/** Extract all CoverageId text from WCS 2.0.1 GetCapabilities XML. */
function extractWcsCoverageIds(xml) {
  const ids = new Set();
  const re = /<wcs:CoverageId>([^<]+)<\/wcs:CoverageId>/g;
  let m;
  while ((m = re.exec(xml)) !== null) ids.add(m[1].trim());
  const re2 = /<CoverageId>([^<]+)<\/CoverageId>/gi;
  while ((m = re2.exec(xml)) !== null) ids.add(m[1].trim());
  return [...ids];
}

/** Extract all Layer Name text from WMS 1.3.0 GetCapabilities XML (unique, top-level names). */
function extractWmsLayerNames(xml) {
  const names = new Set();
  const re = /<Name>([^<]+)<\/Name>/g;
  let m;
  while ((m = re.exec(xml)) !== null) names.add(m[1].trim());
  return [...names];
}

function matchesKeywords(idOrName) {
  const lower = idOrName.toLowerCase();
  return KEYWORDS.filter((k) => lower.includes(k));
}

async function main() {
  console.log("GeoMet PBL / vertical / level layer discovery\n");
  console.log("Keywords:", KEYWORDS.join(", "));
  console.log("");

  const wcsUrl = `${GEOMET_BASE}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCapabilities`;
  const wmsUrl = `${GEOMET_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;

  let wcsIds = [];
  let wmsNames = [];

  try {
    console.log("Fetching WCS GetCapabilities...");
    const wcsXml = await fetchText(wcsUrl);
    wcsIds = extractWcsCoverageIds(wcsXml);
    console.log(`  Found ${wcsIds.length} coverage IDs.\n`);
  } catch (e) {
    console.error("WCS error:", e.message);
  }

  try {
    console.log("Fetching WMS GetCapabilities...");
    const wmsXml = await fetchText(wmsUrl);
    wmsNames = extractWmsLayerNames(wmsXml);
    console.log(`  Found ${wmsNames.length} layer names.\n`);
  } catch (e) {
    console.error("WMS error:", e.message);
  }

  const wcsMatches = wcsIds.filter((id) => matchesKeywords(id).length > 0);
  const wmsMatches = wmsNames.filter((name) => matchesKeywords(name).length > 0);

  console.log("--- WCS coverage IDs matching keywords ---");
  if (wcsMatches.length === 0) {
    console.log("(none)");
  } else {
    for (const id of wcsMatches.sort()) {
      const k = matchesKeywords(id);
      console.log(`  ${id}  [${k.join(", ")}]`);
    }
  }

  console.log("\n--- WMS layer names matching keywords ---");
  if (wmsMatches.length === 0) {
    console.log("(none)");
  } else {
    for (const name of wmsMatches.sort()) {
      const k = matchesKeywords(name);
      console.log(`  ${name}  [${k.join(", ")}]`);
    }
  }

  // Highlight PBL-specific layers (for inversions / PBL-aware lapse)
  const pblOnlyWcs = wcsMatches.filter((id) => /pbl|planetaryboundary|boundarylayer/i.test(id));
  const pblOnlyWms = wmsMatches.filter((name) => /pbl|planetaryboundary|boundarylayer/i.test(name));
  console.log("\n--- PBL-specific (for inversions / PBL-aware lapse) ---");
  console.log("WCS:", pblOnlyWcs.length ? pblOnlyWcs.sort().join(", ") : "(none)");
  console.log("WMS:", pblOnlyWms.length ? pblOnlyWms.sort().join(", ") : "(none)");

  console.log("\nDone. Run: npm run list-geomet-pbl");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
