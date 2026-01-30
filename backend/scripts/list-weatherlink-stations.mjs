#!/usr/bin/env node
/**
 * List WeatherLink v2 stations for your API key. Use this to find Paradise Top and Base (Operations) station_ids.
 * Run from repo root: backend/scripts/list-weatherlink-stations.mjs  OR  from backend/: node scripts/list-weatherlink-stations.mjs
 * Loads WEATHERLINK_API_KEY and WEATHERLINK_API_SECRET from env or from backend/.env (do not commit .env).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load backend/.env if present (KEY=value, no quotes, ignore blanks and comments)
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

if (!apiKey || !apiSecret) {
  console.error("Set WEATHERLINK_API_KEY and WEATHERLINK_API_SECRET in the environment.");
  process.exit(1);
}

const url = new URL("https://api.weatherlink.com/v2/stations");
url.searchParams.set("api-key", apiKey);

const req = https.get(
  url.toString(),
  {
    headers: { "X-Api-Secret": apiSecret },
  },
  (res) => {
    let body = "";
    res.on("data", (ch) => (body += ch));
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.error("API error:", res.statusCode, body);
        process.exit(1);
      }
      try {
        const data = JSON.parse(body);
        const stations = data.stations ?? data;
        if (!Array.isArray(stations) || stations.length === 0) {
          console.log("No stations found for this API key.");
          return;
        }
        console.log("Stations for your API key:\n");
        for (const s of stations) {
          const id = s.station_id ?? s.id;
          const name = s.station_name ?? s.name ?? "—";
          console.log(`  station_id: ${id}  →  ${name}`);
        }
        console.log("\nSet weatherlink_station_id (Paradise Top) and weatherlink_station_id_base (Base) in terraform.tfvars from the IDs above.");
      } catch (e) {
        console.error("Parse error:", e.message, body);
        process.exit(1);
      }
    });
  }
);
req.on("error", (e) => {
  console.error("Request error:", e.message);
  process.exit(1);
});
