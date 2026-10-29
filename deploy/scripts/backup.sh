#!/usr/bin/env bash
# Encrypted Postgres backup (contains OAuth signing keys and refresh tokens: keep it encrypted).
# Usage: deploy/scripts/backup.sh <age-recipient> [out-dir]
set -euo pipefail
RECIPIENT="${1:?age recipient (age1...) required}"
OUT="${2:-./backups}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  | age -r "$RECIPIENT" > "$OUT/enu-den-$STAMP.dump.age"
echo "wrote $OUT/enu-den-$STAMP.dump.age"
