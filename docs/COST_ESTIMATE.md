# Monthly cost estimate (lakeloui.se on AWS ca-west-1)

Rough **total per month** for the current serverless stack. Prices are indicative; use [AWS Pricing Calculator](https://calculator.aws/) and [OpenRouter pricing](https://openrouter.ai/docs#models) for your region and usage.

---

## 1. AWS resources (ca-west-1)

| Service | Usage | Estimate / month (CAD) |
|--------|--------|-------------------------|
| **Lambda** | 1 function, 2 GB RAM, 10 min timeout; EventBridge every 15 min → **~2,880 invocations/month**; **~8–9 s** avg duration (most runs: cached GeoMet, no AI). Big runs (full GeoMet + OpenRouter, e.g. 4am) **~25–35 s**. Verify: Lambda → Monitoring → Duration, or CloudWatch log `Lambda duration ms`. | **~$0.80–1.50** |
| **DynamoDB** | 2 tables (Live_Log, History_Archive), on-demand. ~5–10 reads + ~5–8 writes per run → ~23k read units, ~17k write units. | **~$0.05** |
| **S3** | Frontend: ~1–2 MB (index.html + assets); Archive: ~96 snapshots/day × ~200 KB → ~576 MB new/month, lifecycle to Glacier after 180 days. | **~$0.05–0.15** (frontend + archive Standard; Glacier later) |
| **CloudFront** | 1 distribution; data transfer out + requests. Assume **5–20 GB/month** and **50k–200k** requests (small personal site). | **~$0.50–2** |
| **EventBridge** | 1 rule, 2,880 invocations/month. | **$0** |
| **Route 53** | 1 hosted zone (e.g. lakeloui.se) if using wx.lakeloui.se. | **~$0.50** (if zone used) |
| **API Gateway** | REST API present; no deployed routes yet (placeholder). | **$0** until routes are added |
| **SES** | 4am report email: 1 email/day → ~30/month. | **$0** |
| **ACM** | 1 cert for wx.lakeloui.se (us-east-1 for CloudFront). | **$0** (public certs free) |

**Rough AWS total:** **~$2–5/month** (low traffic, ca-west-1, no free tier).

---

## 2. External (not AWS)

| Service | Usage | Estimate / month |
|--------|--------|------------------|
| **OpenRouter** | AI only when `shouldProcessAI` (e.g. resort XML changed); assume **2–6 runs/day** with AI → **~60–180 calls/month**. Model: e.g. `google/gemini-2.5-flash` (~$0.15/1M input, ~$0.60/1M output). ~2k tokens in, ~200 out per call. | **~$0.05–0.25** (USD) |
| **WeatherLink** | Pro API; polling every 5 min is within typical plan. | Your plan (not billed by this app) |

---

## 3. Total per month (summary)

| Scenario | AWS (CAD) | OpenRouter (USD) | Total (approx.) |
|----------|-----------|------------------|------------------|
| Low traffic (5–20 GB CloudFront) | **~$2–5** | **~$0.05–0.25** | **~$3–6 CAD** |
| Moderate traffic (50 GB CloudFront) | **~$5–10** | **~$0.10–0.50** | **~$6–11 CAD** |

So in practice: **about $3–6 CAD per month** for typical low-traffic use.

---

## 4. How to check your actual cost

- **AWS:** Billing Dashboard → **Cost Explorer** (filter by service, region ca-west-1).
- **OpenRouter:** Dashboard → usage / billing.

---

## 6. What drives cost up

- **Lambda:** More invocations (e.g. going back to 5‑min schedule), longer duration (e.g. slow GeoMet), or higher memory.
- **CloudFront:** More traffic (GB out and requests).
- **DynamoDB:** More reads/writes (e.g. more queries, larger items).
- **S3:** More archive snapshots or longer retention before Glacier.
- **OpenRouter:** More AI runs or heavier models.

Reducing Lambda to 15‑min and only publishing + invalidating when the content hash changes keeps AWS cost low for a small dashboard.
