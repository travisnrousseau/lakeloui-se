#!/usr/bin/env node
/**
 * Fetch WeatherLink v2 current conditions for Paradise Top and Base and print
 * sensor types, data_structure_types, and all keys in the first data record.
 * Use this to see exactly which fields (e.g. wind_dir_*) the API returns.
 *
 * Run from repo root: node backend/scripts/dump-weatherlink-current.mjs
 * Loads WEATHERLINK_API_KEY, WEATHERLINK_API_SECRET, WEATHERLINK_STATION_ID,
 * WEATHERLINK_STATION_ID_BASE from env or backend/.env (do not commit .env).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  try {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = value;
      }
    }
  } catch {
    // .env optional
  }
}
loadEnv();

const apiKey = process.env.WEATHERLINK_API_KEY;
const apiSecret = process.env.WEATHERLINK_API_SECRET;
const stationId = process.env.WEATHERLINK_STATION_ID;
const stationIdBase = process.env.WEATHERLINK_STATION_ID_BASE;

if (!apiKey || !apiSecret) {
  console.error("Set WEATHERLINK_API_KEY and WEATHERLINK_API_SECRET.");
  process.exit(1);
}

const stations = [
  { id: stationId, name: "Paradise Top" },
  { id: stationIdBase, name: "Base (Operations)" },
].filter((s) => s.id && s.id !== "");

if (stations.length === 0) {
  console.error("Set at least one of WEATHERLINK_STATION_ID or WEATHERLINK_STATION_ID_BASE.");
  process.exit(1);
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        let body = "";
        res.on("data", (ch) => (body += ch));
        res.on("end", () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`${res.statusCode} ${body}`))));
      })
      .on("error", reject);
  });
}

async function main() {
  for (const { id, name } of stations) {
    const url = `https://api.weatherlink.com/v2/current/${id}?api-key=${apiKey}`;
    console.log(`\n=== ${name} (station_id: ${id}) ===\n`);
    try {
      const body = await get(url, { "X-Api-Secret": apiSecret });
      const data = body?.data ?? body;
      const sensors = data?.sensors ?? [];
      if (sensors.length === 0) {
        console.log("  No sensors in response.");
        continue;
      }
      for (const sensor of sensors) {
        const st = sensor.sensor_type ?? sensor.lsid;
        const dst = sensor.data_structure_type;
        const recs = sensor.data;
        const rec = Array.isArray(recs) && recs.length > 0 ? recs[0] : null;
        console.log(`  Sensor type: ${st}, data_structure_type: ${dst}`);
        if (rec) {
          const keys = Object.keys(rec).sort();
          console.log(`  Record keys (${keys.length}): ${keys.join(", ")}`);
          const windKeys = keys.filter((k) => k.toLowerCase().includes("wind") || k.toLowerCase().includes("dir"));
          if (windKeys.length > 0) {
            console.log(`  Wind/dir fields and values:`);
            for (const k of windKeys) console.log(`    ${k}: ${rec[k]}`);
          }
        } else {
          console.log("  No data records.");
        }
        console.log("");
      }
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
  }
}

main();
