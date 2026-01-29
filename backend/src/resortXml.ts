import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";

const RESORT_XML_URL = "https://lamp10.skilouise.com/app/mtnxml.php";

/**
 * Parsed resort XML. The live report object may contain additional sections
 * (e.g. restaurants, dining) not listed here; the handler persists the full
 * report to Live_Log RESORT_DATA so nothing is dropped.
 */
export interface ResortData {
  xmlHash: string;
  report: {
    name: string;
    updated: string;
    units: string;
    operations: {
      resortStatus: string;
      openTime: string;
      closeTime: string;
      totalAcres: number;
    };
    currentConditions: {
      resortwide: {
        totalAcresOpen: number;
        totalTrailLengthOpen: number;
        lastSnowfallDate: string;
        lastSnowfallUpdate: string;
      };
      resortLocations: {
        location: Array<{
          name: string;
          primarySurface: string;
          secondarySurface: string;
          base: number;
          snowOverNight: number;
          snow24Hours: number;
          snow48Hours: number;
          snow7Days: number;
          snowYearToDate: number;
          weatherConditions: string;
          temperature: number;
        }>;
      };
      liftsAndRuns: {
        runs: number;
        lifts: number;
        groomed: number;
        info: string;
      };
      terrainPark: {
        status: string;
        parks: number;
        jumps: number;
        boxes: number;
        rails: number;
        other: number;
        features: number;
        info: string;
      };
      tubePark: {
        status: string;
        lanes: number;
        info: string;
      };
    };
    forecast: {
      day: Array<{
        name: string;
        weather: string;
        // high/low ignored per user query
      }>;
    };
    facilities: {
      areas: {
        area: Array<{
          name: string;
          lifts?: {
            lift: Array<{
              id: string;
              name: string;
              status: string;
              type: string;
            }>;
          };
          trails?: {
            trail: Array<{
              id: string;
              name: string;
              status: string;
              groomed: string;
              difficulty: string;
            }>;
          };
        }>;
      };
    };
  };
}

export async function fetchResortXml(): Promise<ResortData> {
  const response = await axios.get(RESORT_XML_URL, {
    timeout: 60_000, // 1 min per call; Lambda timeout 2 min
  });
  const xmlHash = createHash("md5").update(response.data).digest("hex");
  
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: true,
  });

  const jsonObj = parser.parse(response.data);
  jsonObj.xmlHash = xmlHash;

  // Ensure arrays for consistency
  if (jsonObj.report.currentConditions.resortLocations.location && !Array.isArray(jsonObj.report.currentConditions.resortLocations.location)) {
    jsonObj.report.currentConditions.resortLocations.location = [jsonObj.report.currentConditions.resortLocations.location];
  }

  if (jsonObj.report.forecast.day && !Array.isArray(jsonObj.report.forecast.day)) {
    jsonObj.report.forecast.day = [jsonObj.report.forecast.day];
  }

  if (jsonObj.report.facilities.areas.area && !Array.isArray(jsonObj.report.facilities.areas.area)) {
    jsonObj.report.facilities.areas.area = [jsonObj.report.facilities.areas.area];
  }

  jsonObj.report.facilities.areas.area.forEach((area: any) => {
    if (area.lifts?.lift && !Array.isArray(area.lifts.lift)) {
      area.lifts.lift = [area.lifts.lift];
    }
    if (area.trails?.trail && !Array.isArray(area.trails.trail)) {
      area.trails.trail = [area.trails.trail];
    }
  });

  return jsonObj as ResortData;
}

/** Location snow report from Resort XML (one location = one set of numbers) */
export interface PikaSnowReport {
  name: string;
  base: number;
  snowOverNight: number;
  snow24Hours: number;
  snow48Hours: number;
  snow7Days: number;
  snowYearToDate: number;
  temperature: number;
  weatherConditions: string;
  primarySurface: string;
  secondarySurface: string;
  lastSnowfallDate?: string;
  lastSnowfallUpdate?: string;
}

/**
 * Get the Pika (mid-mountain) snow report from resort XML.
 * The resort uses Pika Run for their published snow report; we match location by name.
 */
type ResortLocation = ResortData["report"]["currentConditions"]["resortLocations"]["location"][number];

export function getPikaSnowReport(data: ResortData): PikaSnowReport | null {
  const locations = data.report?.currentConditions?.resortLocations?.location;
  if (!locations || !Array.isArray(locations) || locations.length === 0) return null;

  const normalized = locations.map((loc: ResortLocation) => ({
    ...loc,
    nameLower: (loc.name ?? "").toLowerCase()
  }));
  type LocWithLower = ResortLocation & { nameLower: string };
  const pika = (normalized as LocWithLower[]).find(
    (loc) =>
      loc.nameLower.includes("pika") || loc.nameLower.includes("mid-mountain") || loc.nameLower.includes("mid mountain")
  );
  const loc: LocWithLower = pika ?? (normalized[0] as LocWithLower);
  const resortwide = data.report?.currentConditions?.resortwide;

  return {
    name: loc.name ?? "Unknown",
    base: typeof loc.base === "number" ? loc.base : 0,
    snowOverNight: typeof loc.snowOverNight === "number" ? loc.snowOverNight : 0,
    snow24Hours: typeof loc.snow24Hours === "number" ? loc.snow24Hours : 0,
    snow48Hours: typeof loc.snow48Hours === "number" ? loc.snow48Hours : 0,
    snow7Days: typeof loc.snow7Days === "number" ? loc.snow7Days : 0,
    snowYearToDate: typeof loc.snowYearToDate === "number" ? loc.snowYearToDate : 0,
    temperature: typeof loc.temperature === "number" ? loc.temperature : 0,
    weatherConditions: typeof loc.weatherConditions === "string" ? loc.weatherConditions : "",
    primarySurface: typeof loc.primarySurface === "string" ? loc.primarySurface : "",
    secondarySurface: typeof loc.secondarySurface === "string" ? loc.secondarySurface : "",
    lastSnowfallDate: resortwide?.lastSnowfallDate,
    lastSnowfallUpdate: resortwide?.lastSnowfallUpdate
  };
}
