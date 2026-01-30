# Fixtures for local display work

- **cached-forecast.json** — Written by `node run_dry_render.cjs` when a run succeeds (detailedForecast + msc + forecastTimeline). **Old models to play with:** run dry render once when ECCC is available, then use `node test_render.cjs`; it prefers this cache so you get real model output without live fetches.
- **forecast-bento.json** — Sample HRDPS/RDPS data if no cache exists. Use `USE_FIXTURE=1 node test_render.cjs` to force this instead of cache.
