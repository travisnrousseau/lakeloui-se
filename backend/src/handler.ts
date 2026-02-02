import { createHash } from "crypto";
import type { ScheduledHandler, ScheduledEvent, Context } from "aws-lambda";
import { fetchResortXml, getPikaSnowReport } from "./resortXml.js";
import { fetchAllWaterStations } from "./waterOffice.js";
import { fetchPika, fetchSkoki } from "./pikaSkoki.js";
import { fetchAllWeatherLinkStations, normalizeStationVitals } from "./weatherLink.js";
import { fetchTownsite } from "./townsite.js";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { ForecastPeriod } from "./mscModels.js";
import { fetchGeometForecastTimeline, fetchGeometDetailedForecast } from "./geometForecast.js";
import { renderHtml, type RenderData } from "./renderHtml.js";
import { makeEmailSafe } from "./emailHtml.js";
import {
  generateForecast,
  type ForecastPayload,
} from "./openRouter.js";

/** Canadian models via GeoMet WCS (HRDPS, GDPS). Set GEOMET_ENABLED=1 to fetch. */
const GEOMET_ENABLED = process.env.GEOMET_ENABLED === "1" || process.env.GEOMET_ENABLED === "true";

const MST_TZ = "America/Edmonton";

/** MST hour and minute (0–23, 0–59) for window checks. */
function getMstHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: MST_TZ, hour: "numeric", minute: "numeric", hour12: false });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

/** True only in the first run after 4am MST (4:00–4:14), or when REPORT_TYPE=4am / event reportType=4am (manual test). */
function is4amReport(eventReportType?: string): boolean {
  if (process.env.REPORT_TYPE === "4am" || eventReportType === "4am") return true;
  const { hour, minute } = getMstHourMinute();
  return hour === 4 && minute < 15;
}

/** True in the first run after 6am MST (6:00–6:14) so we run the public report once. */
function is6amReportWindow(): boolean {
  const { hour, minute } = getMstHourMinute();
  return hour === 6 && minute < 15;
}

/** True in the first run after 4am MST (4:00–4:14) so we run 4am report and send email once. */
function is4amReportWindow(): boolean {
  const { hour, minute } = getMstHourMinute();
  return hour === 4 && minute < 15;
}

const WIND_DIR_LABELS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function windDirLabel(deg: number | null | undefined): string {
  if (deg == null) return "—";
  const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return WIND_DIR_LABELS[i];
}

/** Snapshot of resort report (open lifts, groomed runs, snow) for diffing on re-runs (AI_WEATHER_OUTPUT §1.3). */
interface ResortSnapshot {
  open_lifts: string[];
  groomed_runs: string[];
  snow_overnight_cm: number | null;
  snow_24h_cm: number | null;
}

/** Build a short summary of what changed in the resort report (lifts, runs, snow) for the LLM (AI_WEATHER_OUTPUT §1.3). */
function buildResortChangesSummary(prev: ResortSnapshot | null, curr: ResortSnapshot): string | null {
  if (!prev) return null;
  const parts: string[] = [];
  const prevLifts = new Set(prev.open_lifts);
  const currLifts = new Set(curr.open_lifts);
  const opened = curr.open_lifts.filter((l) => !prevLifts.has(l));
  const closed = prev.open_lifts.filter((l) => !currLifts.has(l));
  if (opened.length) parts.push(`Lifts opened: ${opened.join(", ")}`);
  if (closed.length) parts.push(`Lifts closed: ${closed.join(", ")}`);
  const prevRuns = new Set(prev.groomed_runs);
  const newlyGroomed = curr.groomed_runs.filter((r) => !prevRuns.has(r));
  if (newlyGroomed.length) parts.push(`Newly groomed: ${newlyGroomed.slice(0, 5).join(", ")}${newlyGroomed.length > 5 ? "…" : ""}`);
  const snowChanged =
    (prev.snow_overnight_cm != null && curr.snow_overnight_cm != null && prev.snow_overnight_cm !== curr.snow_overnight_cm) ||
    (prev.snow_24h_cm != null && curr.snow_24h_cm != null && prev.snow_24h_cm !== curr.snow_24h_cm);
  if (snowChanged) {
    const bits: string[] = [];
    if (prev.snow_overnight_cm !== curr.snow_overnight_cm && curr.snow_overnight_cm != null)
      bits.push(`${curr.snow_overnight_cm} cm overnight`);
    if (prev.snow_24h_cm !== curr.snow_24h_cm && curr.snow_24h_cm != null)
      bits.push(`${curr.snow_24h_cm} cm in 24 h`);
    if (bits.length) parts.push(`Snow report updated: ${bits.join("; ")}`);
  }
  return parts.length > 0 ? parts.join(". ") : null;
}

/** Build a short text summary of forecast through the day (0–24h) for Stash Finder + clouds (AI_WEATHER_OUTPUT §1.2). */
function buildForecastDaySummary(timeline: ForecastPeriod[]): string | null {
  if (!timeline?.length) return null;
  const keyLeads = [0, 6, 12, 18, 24];
  const parts: string[] = [];
  for (let i = 0; i < keyLeads.length; i++) {
    const lead = keyLeads[i];
    const nextLead = keyLeads[i + 1] ?? lead + 6;
    const period = timeline.find((p) => p.leadHours === lead) ?? timeline.find((p) => p.leadHours >= lead && p.leadHours < nextLead);
    if (!period) continue;
    const wind = period.windSpeed != null ? `${windDirLabel(period.windDir)} ${Math.round(period.windSpeed)} km/h` : "";
    const precip = period.precipMm != null && period.precipMm > 0 ? `${period.precipMm} mm` : "0 mm";
    const base = period.tempBase != null ? `base ${Math.round(period.tempBase)}°C` : "";
    const seg = [lead === 0 ? "Now" : `${lead}h`, wind, precip, base].filter(Boolean).join(", ");
    if (seg) parts.push(seg);
  }
  return parts.length > 0 ? parts.join(". ") : null;
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});
const cloudfrontClient = new CloudFrontClient({});
/** SES identities (WorkMail, verified addresses) are per-region; use us-east-1 where they are verified. */
const sesClient = new SESClient({ region: "us-east-1" });

const LIVE_LOG_TABLE = process.env.LIVE_LOG_TABLE!;
const FRONTEND_BUCKET = process.env.FRONTEND_BUCKET!;
const ARCHIVE_BUCKET = process.env.ARCHIVE_BUCKET ?? null;
const FRONTEND_DISTRIBUTION_ID = process.env.FRONTEND_DISTRIBUTION_ID;

/**
 * Merge timeline with previous snapshot: use previous periods for any lead hour the new fetch doesn't cover
 * (e.g. when the new run doesn't have 0h/3h yet). Keeps "now" and near-term from last run.
 */
function mergeTimelineWithPrevious(
  newTimeline: ForecastPeriod[],
  prevTimeline: ForecastPeriod[] | undefined
): ForecastPeriod[] {
  if (!prevTimeline?.length) return newTimeline;
  const newLeads = new Set(newTimeline.map((p) => p.leadHours));
  const fromPrev = prevTimeline.filter((p) => !newLeads.has(p.leadHours));
  if (fromPrev.length === 0) return newTimeline;
  const merged = [...fromPrev, ...newTimeline].sort((a, b) => a.leadHours - b.leadHours);
  return merged;
}

/**
 * Merge detailed forecast rows with previous: fill missing lead hours (e.g. 0h/3h) from previous snapshot
 * so the table doesn't have gaps when the new run doesn't cover "now" yet.
 * 7-day (rdps7d, gdps7d, rdps7dDays, gdps7dDays) are passed through from new when present, else previous.
 */
function mergeDetailedWithPrevious(
  newDetailed: RenderData["detailedForecast"],
  prevDetailed: RenderData["detailedForecast"] | undefined
): RenderData["detailedForecast"] {
  if (!newDetailed || !prevDetailed) return newDetailed ?? prevDetailed ?? undefined;
  const mergeRow = (
    newRow: ForecastPeriod[] | undefined,
    prevRow: ForecastPeriod[] | undefined
  ): ForecastPeriod[] => {
    const cur = newRow ?? [];
    if (!prevRow?.length) return cur;
    const newLeads = new Set(cur.map((p) => p.leadHours));
    const fromPrev = prevRow.filter((p) => !newLeads.has(p.leadHours));
    if (fromPrev.length === 0) return cur;
    return [...fromPrev, ...cur].sort((a, b) => a.leadHours - b.leadHours);
  };
  return {
    hrdps: mergeRow(newDetailed.hrdps, prevDetailed.hrdps),
    rdps: mergeRow(newDetailed.rdps, prevDetailed.rdps),
    rdps7d: newDetailed.rdps7d?.length ? newDetailed.rdps7d : (prevDetailed.rdps7d ?? []),
    gdps7d: newDetailed.gdps7d?.length ? newDetailed.gdps7d : (prevDetailed.gdps7d ?? []),
    rdps7dDays: newDetailed.rdps7dDays?.length ? newDetailed.rdps7dDays : (prevDetailed.rdps7dDays ?? []),
    gdps7dDays: newDetailed.gdps7dDays?.length ? newDetailed.gdps7dDays : (prevDetailed.gdps7dDays ?? []),
    gdpsTrend: newDetailed.gdpsTrend,
    verticalProfile: newDetailed.verticalProfile ?? [],
    pm25: newDetailed.pm25 ?? null
  };
}

/** Recursively remove NaN, undefined, and Error instances so DynamoDB gets clean values. */
function sanitizeForDynamo(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  if (value instanceof Error) return { message: value.message, name: value.name };
  if (Array.isArray(value)) return value.map(sanitizeForDynamo).filter((v) => v !== undefined);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = sanitizeForDynamo(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * Publish HTML to S3 only when content changed (hash in DDB). Then invalidate CloudFront so edge serves fresh page.
 */
async function publishHtml(html: string): Promise<void> {
  if (!FRONTEND_BUCKET) return;
  const htmlHash = createHash("sha256").update(html).digest("hex");

  const lastHashResult = await docClient.send(new GetCommand({
    TableName: LIVE_LOG_TABLE,
    Key: { pk: "FRONTEND_META", sk: "INDEX_HASH" }
  }));
  if (lastHashResult.Item?.htmlHash === htmlHash) {
    console.log("Index unchanged (hash match). Skipping S3 PUT and CloudFront invalidation.");
    return;
  }

  await s3Client.send(new PutObjectCommand({
    Bucket: FRONTEND_BUCKET,
    Key: "index.html",
    Body: html,
    ContentType: "text/html; charset=utf-8"
  }));
  console.log("Pushed pre-rendered index.html to S3.");

  if (FRONTEND_DISTRIBUTION_ID) {
    await cloudfrontClient.send(new CreateInvalidationCommand({
      DistributionId: FRONTEND_DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `lakeloui-${Date.now()}`,
        Paths: { Quantity: 2, Items: ["/index.html", "/"] }
      }
    }));
    console.log("CloudFront invalidation created for /index.html and /.");
  }

  await docClient.send(new PutCommand({
    TableName: LIVE_LOG_TABLE,
    Item: {
      pk: "FRONTEND_META",
      sk: "INDEX_HASH",
      htmlHash,
      updatedAt: new Date().toISOString()
    }
  }));
}

const REPORT_4AM_EMAIL = process.env.REPORT_4AM_EMAIL?.trim() || "";
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL?.trim() || "";

/**
 * Send the full index HTML (including AI summary) to REPORT_4AM_EMAIL when 4am report runs.
 * Requires REPORT_4AM_EMAIL and SES_FROM_EMAIL (verified in SES) to be set.
 */
async function send4amReportEmail(html: string): Promise<void> {
  if (!REPORT_4AM_EMAIL || !SES_FROM_EMAIL) {
    console.log("4am report email skipped: REPORT_4AM_EMAIL or SES_FROM_EMAIL not set in Lambda env. Set report_4am_email and ses_from_email in terraform.tfvars and apply.");
    return;
  }
  const subject = `Lake Louise 04:00 Report — ${new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "short", day: "numeric" })}`;
  try {
    await sesClient.send(new SendEmailCommand({
      Source: SES_FROM_EMAIL,
      Destination: { ToAddresses: [REPORT_4AM_EMAIL] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    }));
    console.log("4am report email sent to", REPORT_4AM_EMAIL);
  } catch (err) {
    console.error("Failed to send 4am report email:", err);
  }
}

export const handler: ScheduledHandler = async (_event: ScheduledEvent, _context: Context) => {
  const startMs = Date.now();
  try {
    // 1. Fetch WeatherLink Pro API v2 (Paradise/Base) - The "Truth" Sensors (non-blocking: continue on failure)
    let weatherLinkData: Awaited<ReturnType<typeof fetchAllWeatherLinkStations>> = [null, null];
    try {
      weatherLinkData = await fetchAllWeatherLinkStations();
      const fetchedCount = weatherLinkData.filter((s) => s != null).length;
      console.log(`Fetched ${fetchedCount} WeatherLink station(s) (Paradise + Base).`);
    } catch (err) {
      console.error("WeatherLink fetch failed, continuing with empty weather:", err);
    }

    // 2. Fetch Townsite (EC 3053759) for valley-floor temp/bar; backup when WeatherLink missing (non-blocking)
    let townsiteData: Awaited<ReturnType<typeof fetchTownsite>> = null;
    try {
      townsiteData = await fetchTownsite();
      if (townsiteData) console.log("Townsite (valley-floor) data fetched:", townsiteData.stationName);
    } catch (err) {
      console.error("Townsite fetch failed:", err);
    }

    // 3. Fetch WaterOffice GOES (Bow, Pipestone, Louise Creek) (non-blocking)
    let waterData: Awaited<ReturnType<typeof fetchAllWaterStations>> = [];
    try {
      waterData = await fetchAllWaterStations();
      console.log(`Fetched ${waterData.length} water data points.`);
    } catch (err) {
      console.error("WaterOffice fetch failed:", err);
    }

    // 3b. Fetch Pika & Skoki (GOES-18 / ACIS) — stubbed until API available
    let pikaData: Awaited<ReturnType<typeof fetchPika>> = null;
    let skokiData: Awaited<ReturnType<typeof fetchSkoki>> = null;
    try {
      [pikaData, skokiData] = await Promise.all([fetchPika(), fetchSkoki()]);
      if (pikaData) console.log("Fetched Pika (GOES-18).");
      if (skokiData) console.log("Fetched Skoki (GOES-18).");
    } catch (err) {
      console.error("Pika/Skoki fetch failed:", err);
    }

    // 4. Forecast: Canadian models via GeoMet when enabled; hash check like resort XML so we only update when ECCC changes data
    let forecastTimeline: ForecastPeriod[] = [];
    let detailedForecast: RenderData["detailedForecast"] = undefined;
    let geometHash: string | null = null;
    if (GEOMET_ENABLED) {
      let lastGeometHash: string | null = null;
      let lastSnapshot: { forecastTimeline?: unknown; detailedForecast?: unknown } | null = null;
      try {
        const [hashMeta, snapshotResult] = await Promise.all([
          docClient.send(new GetCommand({
            TableName: LIVE_LOG_TABLE,
            Key: { pk: "FRONTEND_META", sk: "GEOMET_HASH" }
          })),
          docClient.send(new QueryCommand({
            TableName: LIVE_LOG_TABLE,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": "LIVE_SNAPSHOT" },
            ScanIndexForward: false,
            Limit: 1
          }))
        ]);
        lastGeometHash = (hashMeta.Item?.geometHash as string) ?? null;
        const latest = snapshotResult.Items?.[0];
        if (latest?.forecastTimeline != null) lastSnapshot = latest as { forecastTimeline: unknown; detailedForecast: unknown };
      } catch (_) {
        // ignore; we'll use fresh fetch
      }
      try {
        const [timeline, detailed] = await Promise.all([
          fetchGeometForecastTimeline(),
          fetchGeometDetailedForecast(),
        ]);
        const prevTimeline = lastSnapshot?.forecastTimeline as ForecastPeriod[] | undefined;
        const prevDetailed = lastSnapshot?.detailedForecast as RenderData["detailedForecast"] | undefined;
        const mergedTimeline = mergeTimelineWithPrevious(timeline, prevTimeline);
        const mergedDetailed = detailed
          ? mergeDetailedWithPrevious(detailed, prevDetailed)
          : (prevDetailed ?? undefined);
        geometHash = createHash("sha256")
          .update(JSON.stringify({ mergedTimeline, mergedDetailed }))
          .digest("hex");
        if (lastGeometHash !== null && geometHash === lastGeometHash && lastSnapshot?.forecastTimeline != null) {
          forecastTimeline = (lastSnapshot.forecastTimeline as ForecastPeriod[]) ?? mergedTimeline;
          detailedForecast = (lastSnapshot.detailedForecast as RenderData["detailedForecast"]) ?? mergedDetailed;
          console.log("GeoMet unchanged (hash match). Using cached forecast.");
        } else {
          forecastTimeline = mergedTimeline;
          detailedForecast = mergedDetailed;
          if (mergedTimeline.length > 0) {
            const filled = mergedTimeline.length - timeline.length;
            if (filled > 0) {
              console.log(`GeoMet forecast: ${mergedTimeline.length} timeline period(s) (${filled} from previous run).`);
            } else {
              console.log(`GeoMet forecast: ${mergedTimeline.length} timeline period(s).`);
            }
          }
        }
      } catch (err) {
        console.error("GeoMet forecast fetch failed:", err);
        if (lastSnapshot?.forecastTimeline != null) {
          forecastTimeline = lastSnapshot.forecastTimeline as ForecastPeriod[];
          detailedForecast = (lastSnapshot.detailedForecast as RenderData["detailedForecast"]) ?? undefined;
          console.log("Using previous snapshot forecast after fetch failure.");
        }
      }
    }

    // 5. Mountain Ops - Resort XML (3 AM - 3 PM MST). Non-blocking; use last snow report from DDB if fetch fails.
    const now = new Date();
    const utcHour = now.getUTCHours();
    const isOperationalWindow = utcHour >= 10 && utcHour < 22;

    let resortData: Awaited<ReturnType<typeof fetchResortXml>> | null = null;
    let shouldProcessAI = false;

    if (isOperationalWindow) {
      try {
        resortData = await fetchResortXml();
        console.log("Fetched Resort XML:", resortData.report.name, "updated at", resortData.report.updated);

        await docClient.send(new PutCommand({
          TableName: LIVE_LOG_TABLE,
          Item: sanitizeForDynamo({
            pk: "RESORT_DATA",
            sk: "LATEST",
            xmlHash: resortData.xmlHash,
            updatedAt: now.toISOString(),
            report: resortData.report as Record<string, unknown>
          }) as Record<string, unknown>
        }));

        const lastHashResult = await docClient.send(new GetCommand({
          TableName: LIVE_LOG_TABLE,
          Key: { pk: "RESORT_XML_META", sk: "LATEST" }
        }));
        const lastHash = lastHashResult.Item?.xmlHash;
        const isXmlChanged = lastHash !== resortData.xmlHash;

        if (!isXmlChanged) {
          console.log("Resort XML unchanged (MD5 match). Skipping AI processing.");
        } else {
          console.log("Resort XML changed. Proceeding with AI processing.");
          shouldProcessAI = true;
          await docClient.send(new PutCommand({
            TableName: LIVE_LOG_TABLE,
            Item: sanitizeForDynamo({
              pk: "RESORT_XML_META",
              sk: "LATEST",
              xmlHash: resortData.xmlHash,
              updatedAt: now.toISOString()
            }) as Record<string, unknown>
          }));
        }
      } catch (err) {
        console.error("Resort XML fetch failed, using last snow report if any:", err);
      }
    } else {
      console.log(`Outside operational window (${utcHour} UTC). Skipping Resort XML and AI.`);
    }

    // Manual 4am test: invoke with payload {"reportType": "4am"} to force AI and send 4am email
    const eventReportType = (_event as ScheduledEvent & { reportType?: string }).reportType;
    if (eventReportType === "4am") {
      shouldProcessAI = true;
      console.log("Manual 4am test: forcing AI processing and 4am email.");
    }
    // 4am run once in 4:00–4:14 MST; 6am report runs once in 6:00–6:14 MST
    if (is4amReportWindow()) {
      shouldProcessAI = true;
      console.log("4am report window (MST): running AI and sending 4am email.");
    }
    if (is6amReportWindow()) {
      shouldProcessAI = true;
      console.log("6am report window (MST): running AI for public report.");
    }

    // Snow report: use fresh Pika from resort XML when in window; otherwise last persisted report
    let pikaSnowReport: Awaited<ReturnType<typeof getPikaSnowReport>> = resortData ? getPikaSnowReport(resortData) : null;
    let snowReportUpdatedAt: string | undefined;

    if (pikaSnowReport) {
      snowReportUpdatedAt = now.toISOString();
      await docClient.send(new PutCommand({
        TableName: LIVE_LOG_TABLE,
        Item: sanitizeForDynamo({
          pk: "LAST_SNOW_REPORT",
          sk: "PIKA",
          ...pikaSnowReport,
          updatedAt: snowReportUpdatedAt
        }) as Record<string, unknown>
      }));
    } else {
      const lastSnow = await docClient.send(new GetCommand({
        TableName: LIVE_LOG_TABLE,
        Key: { pk: "LAST_SNOW_REPORT", sk: "PIKA" }
      }));
      if (lastSnow.Item && typeof lastSnow.Item.updatedAt === "string") {
        pikaSnowReport = {
          name: String(lastSnow.Item.name ?? "Pika"),
          base: Number(lastSnow.Item.base ?? 0),
          snowOverNight: Number(lastSnow.Item.snowOverNight ?? 0),
          snow24Hours: Number(lastSnow.Item.snow24Hours ?? 0),
          snow48Hours: Number(lastSnow.Item.snow48Hours ?? 0),
          snow7Days: Number(lastSnow.Item.snow7Days ?? 0),
          snowYearToDate: Number(lastSnow.Item.snowYearToDate ?? 0),
          temperature: Number(lastSnow.Item.temperature ?? 0),
          weatherConditions: String(lastSnow.Item.weatherConditions ?? ""),
          primarySurface: String(lastSnow.Item.primarySurface ?? ""),
          secondarySurface: String(lastSnow.Item.secondarySurface ?? ""),
          lastSnowfallDate: lastSnow.Item.lastSnowfallDate as string | undefined,
          lastSnowfallUpdate: lastSnow.Item.lastSnowfallUpdate as string | undefined
        };
        snowReportUpdatedAt = lastSnow.Item.updatedAt as string;
      }
    }

    const heavySnow = pikaSnowReport != null && pikaSnowReport.snow24Hours >= 15;

    // Inversion: high pressure only (no Canadian model 850/700 mb when using NOAA)
    // weatherLinkData is [Paradise, Base] (null for missing). Preserve order for render: index 0 = summit, 1 = base.
    let weatherForRender = await Promise.all(weatherLinkData.map(async (s, idx) => {
      if (!s) return {};
      const v = normalizeStationVitals(s);
      
      const pk = `STATION_WIND_DIR_${idx}`;
      const sk = "LATEST";
      
      let finalDir = v.wind_direction_deg;
      
      if (finalDir != null) {
        // Persist the new direction
        await docClient.send(new PutCommand({
          TableName: LIVE_LOG_TABLE,
          Item: {
            pk,
            sk,
            deg: finalDir,
            updatedAt: now.toISOString()
          }
        }));
      } else {
        // Try to fetch the last known direction from DynamoDB
        try {
          const lastDirResult = await docClient.send(new GetCommand({
            TableName: LIVE_LOG_TABLE,
            Key: { pk, sk }
          }));
          if (lastDirResult.Item?.deg != null) {
            finalDir = Number(lastDirResult.Item.deg);
          }
        } catch (err) {
          console.error(`Error fetching last wind direction for station ${idx}:`, err);
        }
      }

      return {
        temp: v.temp ?? undefined,
        wind_speed: v.wind_speed ?? undefined,
        wind_direction_deg: finalDir ?? undefined,
        feels_like: v.feels_like ?? undefined,
        bar_sea_level: v.bar_sea_level ?? undefined,
        data_ts: s.ts ?? undefined
      };
    }));
    const summitTempVal = weatherForRender[0]?.temp;
    const baseTempVal = weatherForRender[1]?.temp;
    const summitWindVal = weatherForRender[0]?.wind_speed;
    const baseWindVal = weatherForRender[1]?.wind_speed;
    const summitDir = weatherForRender[0]?.wind_direction_deg;
    const baseDir = weatherForRender[1]?.wind_direction_deg;
    if (summitTempVal != null || baseTempVal != null || summitWindVal != null || baseWindVal != null) {
      console.log(
        `WeatherLink vitals: Summit temp=${summitTempVal ?? "—"} wind=${summitWindVal ?? "—"} km/h dir=${summitDir != null ? summitDir + "°" : "—"} | Base temp=${baseTempVal ?? "—"} wind=${baseWindVal ?? "—"} km/h dir=${baseDir != null ? baseDir + "°" : "—"}`
      );
    }
    // Townsite: kept in code only; do not use for display or as fallback (DATA_SOURCES.md).
    // Inversion: 850 vs 700 mb temp (HRDPS) and/or high surface pressure (WeatherLink bar in hPa)
    const barHigh = weatherForRender.some((w) => w.bar_sea_level != null && w.bar_sea_level > 1018);
    const inversionActive = barHigh;

    // Forecast narrative: OpenRouter when shouldProcessAI and OPENROUTER_API_KEY set; else fallback
    let aiScript = "Conditions as last report. Next update when resort data changes.";
    let stashName = "Saddleback / Larch";
    let stashWhy = "Groomed runs are a safer bet when conditions are uncertain.";
    const use4amReport = eventReportType === "4am" || is4amReport();
    let stashCardLabel: string = "STASH FINDER";

    let currentResortSnapshot: ResortSnapshot | null = null;

    if (shouldProcessAI) {
      const payload: ForecastPayload = {
        summit_temp_c: weatherForRender[0]?.temp ?? null,
        base_temp_c: weatherForRender[1]?.temp ?? null,
        summit_wind_kmh: weatherForRender[0]?.wind_speed ?? null,
        base_wind_kmh: weatherForRender[1]?.wind_speed ?? null,
        summit_wind_dir_deg: weatherForRender[0]?.wind_direction_deg ?? null,
        base_wind_dir_deg: weatherForRender[1]?.wind_direction_deg ?? null,
        inversion_active: inversionActive,
        // 4am report: do not use resort snow; model uses Pika GOES only (AI_WEATHER_OUTPUT §1.1)
        snow_24h_cm: use4amReport ? null : (pikaSnowReport?.snow24Hours ?? null),
        snow_overnight_cm: use4amReport ? null : (pikaSnowReport?.snowOverNight ?? null),
        open_lifts: [],
        groomed_runs: [],
        history_alert: null,
      };
      if (resortData?.report?.facilities?.areas?.area) {
        const areas = resortData.report.facilities.areas.area;
        const openLifts: string[] = [];
        const groomedRuns: string[] = [];
        for (const area of areas) {
          for (const lift of area.lifts?.lift ?? []) {
            if (lift?.status === "Open" && lift?.name) openLifts.push(String(lift.name));
          }
          for (const trail of area.trails?.trail ?? []) {
            if (trail?.status === "Open" && String(trail?.groomed ?? "").toLowerCase() === "yes" && trail?.name) {
              groomedRuns.push(String(trail.name));
            }
          }
        }
        payload.open_lifts = openLifts;
        payload.groomed_runs = groomedRuns;
        currentResortSnapshot = {
          open_lifts: openLifts,
          groomed_runs: groomedRuns,
          snow_overnight_cm: pikaSnowReport?.snowOverNight ?? null,
          snow_24h_cm: pikaSnowReport?.snow24Hours ?? null,
        };
      }
      // Resort report changes (re-run after 6am): compare to previous snapshot so LLM can call out what changed (AI_WEATHER_OUTPUT §1.3)
      if (!use4amReport && currentResortSnapshot) {
        const prevSnapshotResult = await docClient.send(new GetCommand({
          TableName: LIVE_LOG_TABLE,
          Key: { pk: "RESORT_SNAPSHOT_PREV", sk: "LATEST" }
        }));
        const prev = prevSnapshotResult.Item as ResortSnapshot | undefined;
        const prevSnapshot: ResortSnapshot | null = prev && Array.isArray(prev.open_lifts) && Array.isArray(prev.groomed_runs)
          ? {
              open_lifts: prev.open_lifts,
              groomed_runs: prev.groomed_runs,
              snow_overnight_cm: typeof prev.snow_overnight_cm === "number" ? prev.snow_overnight_cm : null,
              snow_24h_cm: typeof prev.snow_24h_cm === "number" ? prev.snow_24h_cm : null,
            }
          : null;
        const resortReportChanges = buildResortChangesSummary(prevSnapshot, currentResortSnapshot);
        if (resortReportChanges) payload.resort_report_changes = resortReportChanges;
      }
      // Pika & Skoki (GOES-18) pillow data — 4am uses Pika for narrative; Skoki for context only (AI_WEATHER_OUTPUT)
      if (pikaData) {
        payload.pika_goes_12h_mm = pikaData.precip12hMm ?? null;
        payload.pika_goes_24h_mm = pikaData.precip24hMm ?? null;
        payload.pika_goes_48h_mm = pikaData.precip48hMm ?? null;
        payload.pika_goes_7d_mm = pikaData.precip7dMm ?? null;
        payload.pika_goes_observed_at = pikaData.timestamp ?? null;
      }
      if (skokiData) {
        payload.skoki_goes_12h_mm = skokiData.precip12hMm ?? null;
        payload.skoki_goes_24h_mm = skokiData.precip24hMm ?? null;
        payload.skoki_goes_48h_mm = skokiData.precip48hMm ?? null;
        payload.skoki_goes_7d_mm = skokiData.precip7dMm ?? null;
        payload.skoki_goes_observed_at = skokiData.timestamp ?? null;
      }
      // 4am report: add HRDPS/RDPS 12h forecast, freezing level, Pika time, and explicit physics flags
      payload.snow_report_observed_at = pikaSnowReport?.lastSnowfallUpdate ?? pikaSnowReport?.lastSnowfallDate ?? null;
      const hrdpsPeriods = (detailedForecast?.hrdps ?? forecastTimeline).filter(
        (p) => p.leadHours <= 12 && (p.source === "HRDPS" || !detailedForecast?.hrdps?.length)
      );
      const period12 = hrdpsPeriods.find((p) => p.leadHours === 12) ?? hrdpsPeriods.find((p) => p.leadHours === 6);
      // GeoMet Total Precipitation is accumulated from ref time; 12h lead value = 0–12h total (not sum of periods)
      const forecast12hPrecipMm = period12?.precipMm != null && period12.precipMm > 0 ? period12.precipMm : null;
      payload.forecast_12h_precip_mm = forecast12hPrecipMm;
      payload.forecast_12h_wind_kmh = period12?.windSpeed ?? null;
      payload.forecast_12h_wind_dir_deg = period12?.windDir ?? null;
      payload.forecast_12h_temp_base_c = period12?.tempBase ?? null;
      payload.forecast_12h_temp_summit_c = period12?.tempSummit ?? null;
      const vp = detailedForecast?.verticalProfile ?? [];
      let freezingLevel: number | null = null;
      if (vp.length >= 2) {
        const sorted = [...vp].sort((a, b) => a.level - b.level);
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i];
          const b = sorted[i + 1];
          if ((a.temp <= 0 && b.temp >= 0) || (a.temp >= 0 && b.temp <= 0)) {
            const t = (0 - a.temp) / (b.temp - a.temp);
            freezingLevel = Math.round(a.level + t * (b.level - a.level));
            break;
          }
        }
      }
      payload.freezing_level_m = freezingLevel;
      const baseTemp = weatherForRender[1]?.temp;
      const summitTemp = weatherForRender[0]?.temp;
      const sumWind = weatherForRender[0]?.wind_speed;
      const baseWind = weatherForRender[1]?.wind_speed;
      const sumDir = weatherForRender[0]?.wind_direction_deg;
      const isWesterly = (deg: number) => deg >= 180 && deg <= 360;
      const isWSW = (deg: number) => deg >= 225 && deg <= 315;
      payload.physics_chinook =
        baseTemp != null && summitTemp != null && baseTemp > summitTemp && sumDir != null && isWSW(sumDir);
      payload.physics_orographic =
        sumDir != null && isWesterly(sumDir) && (forecast12hPrecipMm ?? 0) > 0;
      payload.physics_valley_channelling =
        (sumWind != null && baseWind != null && sumWind - baseWind > 15) || (sumWind != null && sumWind > 40);

      // 6am Stash Finder: day-ahead summary (wind, precip, temps by period) so model can use overnight + forecast + clouds
      payload.forecast_day_summary = buildForecastDaySummary(detailedForecast?.hrdps ?? forecastTimeline);

      const reportType = use4amReport ? "4am" : "6am";
      const forecastResult = await generateForecast(payload, reportType);
      if (forecastResult) {
        if (use4amReport) {
          // 4am: put full technical brief in STASH FINDER area (AI_WEATHER_OUTPUT §1.1)
          stashCardLabel = "04:00 REPORT";
          stashName = "04:00 REPORT";
          stashWhy = forecastResult.summary;
          aiScript = "Technical brief for Snow Reporters in the 04:00 card below.";
        } else {
          aiScript = forecastResult.summary;
          if (forecastResult.stash_name) stashName = forecastResult.stash_name;
          if (forecastResult.stash_note) stashWhy = forecastResult.stash_note;
        }
      } else {
        aiScript = "Conditions as last report. Next update when resort data changes.";
        stashName = "Saddleback / Larch";
        stashWhy = "Groomed runs are a safer bet when conditions are uncertain.";
      }
    }

    const renderData: RenderData = {
      weather: weatherForRender,
      forecastTimeline,
      detailedForecast: detailedForecast ?? undefined,
      aiScript,
      stashName,
      stashWhy,
      stashCardLabel,
      inversionActive,
      heavySnow,
      snowReport: pikaSnowReport ?? undefined,
      snowReportUpdatedAt,
      waterOffice: waterData.length > 0 ? waterData : undefined,
      goesStations: { pika: pikaData ?? undefined, skoki: skokiData ?? undefined }
    };
    const html = renderHtml(renderData);
    await publishHtml(html);

    // Persist current resort snapshot for next run's "what changed" diff (AI_WEATHER_OUTPUT §1.3)
    if (shouldProcessAI && currentResortSnapshot) {
      await docClient.send(new PutCommand({
        TableName: LIVE_LOG_TABLE,
        Item: sanitizeForDynamo({
          pk: "RESORT_SNAPSHOT_PREV",
          sk: "LATEST",
          ...currentResortSnapshot,
          updatedAt: now.toISOString()
        }) as Record<string, unknown>
      }));
    }

    if (use4amReport) {
      await send4amReportEmail(makeEmailSafe(html));
    }

    // Explicit tracking when wind direction is not provided (vs. missing data). Persist for auditing.
    const weatherSummary = {
      summit: {
        wind_direction_provided: summitDir != null,
        data_ts: weatherLinkData[0]?.ts ?? null
      },
      base: {
        wind_direction_provided: baseDir != null,
        data_ts: weatherLinkData[1]?.ts ?? null
      }
    };

    // Store everything for future use (omit NaN/error). Full snapshot every run.
    const logItem = sanitizeForDynamo({
      pk: "LIVE_SNAPSHOT",
      sk: now.toISOString(),
      weather: weatherLinkData,
      weatherSummary,
      townsite: townsiteData ?? null,
      water: waterData,
      forecastTimeline,
      detailedForecast,
      geometHash: geometHash ?? null,
      resort: resortData ? resortData.report : null,
      resortLocations: resortData ? resortData.report.currentConditions?.resortLocations : null,
      resortXmlHash: resortData?.xmlHash ?? null,
      aiScript,
      stashName,
      stashWhy,
      inversionActive,
      heavySnow,
      snowReport: pikaSnowReport ?? null,
      snowReportUpdatedAt: snowReportUpdatedAt ?? null,
      ttl: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 day TTL
    }) as Record<string, unknown>;

    await docClient.send(new PutCommand({
      TableName: LIVE_LOG_TABLE,
      Item: logItem
    }));

    // Archive snapshot to S3 for long-term lookback (180d → Glacier; ARCHITECTURE §6)
    if (ARCHIVE_BUCKET) {
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      const iso = now.toISOString().replace(/:/g, "-");
      const archiveKey = `snapshots/${y}/${m}/${d}/snapshot-${iso}.json`;
      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: ARCHIVE_BUCKET,
          Key: archiveKey,
          Body: JSON.stringify(logItem, null, 0),
          ContentType: "application/json"
        }));
      } catch (archiveErr) {
        console.error("Archive S3 write failed:", archiveErr);
      }
    }

    if (geometHash != null) {
      await docClient.send(new PutCommand({
        TableName: LIVE_LOG_TABLE,
        Item: {
          pk: "FRONTEND_META",
          sk: "GEOMET_HASH",
          geometHash,
          updatedAt: now.toISOString()
        }
      }));
    }

    // When AI ran, append to AI report history for future use
    if (shouldProcessAI) {
      const aiReportItem = sanitizeForDynamo({
        pk: "AI_REPORT",
        sk: now.toISOString(),
        aiScript,
        stashName,
        stashWhy,
        resortXmlHash: resortData?.xmlHash ?? null,
        inversionActive,
        heavySnow,
        ttl: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365) // 1 year TTL for AI history
      }) as Record<string, unknown>;
      await docClient.send(new PutCommand({
        TableName: LIVE_LOG_TABLE,
        Item: aiReportItem
      }));
    }

    const durationMs = Date.now() - startMs;
    console.log("Lambda duration ms:", durationMs);
  } catch (error) {
    console.error("Error in orchestrator:", error);
    console.log("Lambda duration ms (before error):", Date.now() - startMs);
  }
};
