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

# Replace WeatherLink variable lines; keep the rest of the file.
tmp=$(mktemp)
grep -v '^weatherlink_api_key\s\|^weatherlink_api_secret\s\|^weatherlink_station_id\s\|^weatherlink_station_id_base\s' "$TFVARS" > "$tmp" || true
# Insert after the second comment block (after "weatherlink_station_id_base   = ..." line we removed, we need to add after line 3)
# So: lines 1-3, new weatherlink vars, then remaining lines (domain_name, route53_zone_id, etc.)
{
  head -n 3 "$tmp"
  printf 'weatherlink_api_key            = "%s"\n' "${WEATHERLINK_API_KEY:-}"
  printf 'weatherlink_api_secret        = "%s"\n' "${WEATHERLINK_API_SECRET:-}"
  printf 'weatherlink_station_id        = "%s"   # Paradise Top (Skilouise Paradise Top)\n' "${WEATHERLINK_STATION_ID:-23431}"
  printf 'weatherlink_station_id_base   = "%s"   # Base (Skilouise Operations)\n' "${WEATHERLINK_STATION_ID_BASE:-23428}"
  tail -n +4 "$tmp"
} > "$TFVARS.new"
rm -f "$tmp"
mv "$TFVARS.new" "$TFVARS"
echo "Updated WeatherLink vars in $TFVARS from backend/.env"
