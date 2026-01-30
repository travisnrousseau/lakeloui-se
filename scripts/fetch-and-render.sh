#!/usr/bin/env bash
# Fetch latest data and render dashboard HTML. Safe for cron or manual run.
# Output: /tmp/lakeloui_live_dry_index.html and backend/fixtures/cached-forecast.json
set -e
cd "$(dirname "$0")/../backend"
npm run dry-render
echo "Done. Open /tmp/lakeloui_live_dry_index.html or /tmp/lakeloui_test_index.html"
