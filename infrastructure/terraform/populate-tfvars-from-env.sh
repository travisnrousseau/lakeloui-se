#!/usr/bin/env bash
# Populate WeatherLink vars in terraform.tfvars from backend/.env.
# Run from repo root: infrastructure/terraform/populate-tfvars-from-env.sh
# Or from this dir: ./populate-tfvars-from-env.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
TFVARS="$SCRIPT_DIR/terraform.tfvars"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$TFVARS" ]]; then
  echo "Missing $TFVARS (copy from terraform.tfvars.example first)" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

for key in WEATHERLINK_API_KEY WEATHERLINK_API_SECRET; do
  if [[ -z "${!key}" ]]; then
    echo "Warning: $key is empty in .env" >&2
  fi
done

# Replace WeatherLink + OpenRouter + 4am email variable lines; keep the rest of the file.
tmp=$(mktemp)
grep -v '^weatherlink_api_key\s\|^weatherlink_api_secret\s\|^weatherlink_station_id\s\|^weatherlink_station_id_base\s\|^openrouter_api_key\s\|^report_4am_email\s\|^ses_from_email\s' "$TFVARS" > "$tmp" || true
{
  head -n 3 "$tmp"
  printf 'weatherlink_api_key            = "%s"\n' "${WEATHERLINK_API_KEY:-}"
  printf 'weatherlink_api_secret        = "%s"\n' "${WEATHERLINK_API_SECRET:-}"
  printf 'weatherlink_station_id        = "%s"   # Paradise Top (Skilouise Paradise Top)\n' "${WEATHERLINK_STATION_ID:-23431}"
  printf 'weatherlink_station_id_base   = "%s"   # Base (Skilouise Operations)\n' "${WEATHERLINK_STATION_ID_BASE:-23428}"
  printf 'openrouter_api_key            = "%s"   # OpenRouter AI narrative (6am/4am); leave empty to skip\n' "${OPENROUTER_API_KEY:-}"
  printf 'report_4am_email               = "%s"   # 4am report recipient; leave empty to disable email\n' "${REPORT_4AM_EMAIL:-}"
  printf 'ses_from_email                = "%s"   # SES verified From (e.g. info@rousseau.tv)\n' "${SES_FROM_EMAIL:-}"
  tail -n +4 "$tmp"
} > "$TFVARS.new"
rm -f "$tmp"
mv "$TFVARS.new" "$TFVARS"
echo "Updated WeatherLink, OpenRouter, and 4am email vars in $TFVARS from backend/.env"
