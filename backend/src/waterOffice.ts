import axios from "axios";

/**
 * WaterOffice (Environment Canada) real-time hydrometric fetcher.
 * Data is transmitted via GOES/telemetry; real-time stations report every 1–6 hours.
 *
 * Confirmed GOES stations in Bow basin (WaterOffice):
 * - 05BA001 — Bow River at Lake Louise (level, discharge)
 * - 05BA002 — Pipestone River near Lake Louise (level, discharge)
 * - 05BA004 — Louise Creek near Lake Louise (outlet of lake; Victoria Glacier discharge)
 *
 * Pika and Skoki are NOT in WaterOffice as hydrometric stations. 05BA011 is Balfour Creek.
 * Pika (weather) / Skoki (snow pillow SWE) are in other systems (see docs/DATA_SOURCES.md §2).
 */

const WATEROFFICE_BASE_URL = "https://wateroffice.ec.gc.ca/services/real_time_data/csv/inline";

/** API requires stations[], parameters[] (46=level, 47=discharge), start_date, end_date (UTC). */
const PARAM_IDS = ["46", "47"]; // Water level unit values, Discharge unit values

export interface WaterData {
  stationId: string;
  name: string;
  timestamp: string;
  value: number;
  unit: string;
  parameter: "Discharge" | "Water Level" | "Temperature";
}

function toUTC(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

export async function fetchWaterOfficeData(stationId: string): Promise<WaterData[]> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000); // last 7 days
    const params = new URLSearchParams();
    params.append("stations[]", stationId);
    PARAM_IDS.forEach((p) => params.append("parameters[]", p));
    params.set("start_date", toUTC(start));
    params.set("end_date", toUTC(end));

    const response = await axios.get(`${WATEROFFICE_BASE_URL}?${params.toString()}`, {
      timeout: 60_000,
      headers: { Accept: "text/csv" },
      validateStatus: (status) => status === 200,
    });

    const text = typeof response.data === "string" ? response.data : "";
    const lines = text.trim().split("\n");
    const data: WaterData[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length >= 3) {
        const val = parseFloat(parts[2]);
        if (Number.isNaN(val)) continue;
        data.push({
          stationId,
          name: parts[0]?.replace(/"/g, "").trim() || stationId,
          timestamp: parts[1]?.replace(/"/g, "").trim() || "",
          value: val,
          unit: parts[3]?.replace(/"/g, "").trim() || "",
          parameter: (parts[4]?.replace(/"/g, "").trim() as WaterData["parameter"]) || "Discharge",
        });
      }
    }

    return data;
  } catch (error) {
    console.error(`Error fetching WaterOffice data for ${stationId}:`, error);
    return [];
  }
}

/** Only confirmed WaterOffice real-time (GOES) stations. Pika/Skoki use other sources — see DATA_SOURCES.md. */
const WATEROFFICE_STATIONS = [
  { id: "05BA001", name: "Bow River at Lake Louise" },
  { id: "05BA002", name: "Pipestone River near Lake Louise" },
  { id: "05BA004", name: "Louise Creek near Lake Louise" },
];

export async function fetchAllWaterStations() {
  const results = await Promise.all(
    WATEROFFICE_STATIONS.map((s) => fetchWaterOfficeData(s.id))
  );
  return results.flat();
}
