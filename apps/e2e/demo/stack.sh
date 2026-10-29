#!/usr/bin/env bash
# Demo stack for the video (apps/e2e/demo): web :3200 and realtime :2767 on a fresh database, seeded with
# the pseudonymous example roster. With DEMO_CLOCK=HH:MM (Asia/Seoul) and libfaketime installed, the
# database, web and realtime run on a clock shifted to that time on the next business-day morning, so the
# demo shows office hours whatever the real time. Stop with `stack.sh stop`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUN="${DEMO_RUN_DIR:-/tmp/enu-den-demo}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$RUN/pg"
PGPORT="${DEMO_PG_PORT:-5544}"
WEB_PORT="${DEMO_WEB_PORT:-3200}"
RT_PORT="${DEMO_RT_PORT:-2767}"
FAKETIME_LIB="${FAKETIME_LIB:-/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1}"
mkdir -p "$RUN"

stop() {
  for f in web realtime; do
    # Each server runs in its own process group (setsid): stop the whole group.
    if [ -f "$RUN/$f.pid" ]; then kill -- "-$(cat "$RUN/$f.pid")" 2>/dev/null || true; fi
    rm -f "$RUN/$f.pid"
  done
  if [ -f "$PGDATA/postmaster.pid" ]; then runuser -u postgres -- "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null || true; fi
}
if [ "${1:-start}" = "stop" ]; then stop; exit 0; fi
stop

# Clock: seconds to add so that "now" is DEMO_CLOCK on the next weekday morning (Asia/Seoul).
OFFSET=0
if [ -n "${DEMO_CLOCK:-}" ] && [ -f "${FAKETIME_LIB/MT/}" ]; then
  OFFSET="$(python3 - "$DEMO_CLOCK" <<'PY'
import datetime as dt, sys
h, m = map(int, sys.argv[1].split(':'))
kst = dt.timezone(dt.timedelta(hours=9))
now = dt.datetime.now(kst)
t = now.replace(hour=h, minute=m, second=0, microsecond=0)
while t < now or t.weekday() >= 5:
    t += dt.timedelta(days=1)
print(int((t - now).total_seconds()))
PY
)"
fi
FAKE=()
if [ "$OFFSET" != 0 ]; then FAKE=(env LD_PRELOAD="$FAKETIME_LIB" FAKETIME="+$OFFSET" FAKETIME_DONT_FAKE_MONOTONIC=1); fi

# A private Postgres cluster (it must share the shifted clock: rows default to now()).
rm -rf "$PGDATA" && mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA"
runuser -u postgres -- "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
runuser -u postgres -- "${FAKE[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/log" -w \
  -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" start >/dev/null
"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "create role enu login password 'enu' superuser"
"$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -qc "create database enu_den_demo owner enu"

export NODE_ENV=development DATABASE_URL="postgres://enu:enu@127.0.0.1:$PGPORT/enu_den_demo"
export SEATS_FILE="$ROOT/config/seats.example.json"
cd "$ROOT"
"${FAKE[@]}" pnpm --filter @enu/db migrate >/dev/null
"${FAKE[@]}" pnpm --filter @enu/db seed:seats >/dev/null
"${FAKE[@]}" pnpm --filter @enu/db seed:dev >/dev/null
# The demo's cast starts the morning without the generic demo chats, logs, nudges and to-dos.
"$PGBIN/psql" "$DATABASE_URL" -q <<'SQL'
with cast_members as (select user_id from profiles where display_name in ('직원07', '직원04', '직원11'))
, a as (delete from pet_messages where user_id in (select user_id from cast_members))
, b as (delete from work_logs where user_id in (select user_id from cast_members))
, c as (delete from pet_nudges where user_id in (select user_id from cast_members))
delete from todos where user_id in (select user_id from cast_members);
SQL

TICKET=demo-ticket-secret-0123456789abcdef0123456789
REALTIME_PORT=$RT_PORT REALTIME_TICKET_SECRET=$TICKET MAPS_DIR="$ROOT/apps/web/public/assets/maps" \
  ALLOWED_ORIGINS="http://localhost:$WEB_PORT" NUDGE_JOIN_DELAY_MS=1500 NUDGE_MIN_INTERVAL_MIN=0 NUDGE_TICK_MS=500 \
  LOG_LEVEL=warn setsid nohup "${FAKE[@]}" pnpm --filter @enu/realtime exec tsx src/index.ts >"$RUN/realtime.log" 2>&1 &
echo $! >"$RUN/realtime.pid"
PUBLIC_URL="http://localhost:$WEB_PORT" BETTER_AUTH_SECRET=demo-auth-secret-0123456789abcdef0123456789 \
  DEV_LOGIN_ENABLED=1 ALLOWED_GOOGLE_HD=enu-tech.co.kr ADMIN_EMAILS=dev.r1@enu-tech.co.kr \
  REALTIME_TICKET_SECRET=$TICKET REALTIME_PUBLIC_URL="ws://localhost:$RT_PORT" \
  INTERNAL_BASE_URL="http://127.0.0.1:$WEB_PORT" PORT=$WEB_PORT \
  setsid nohup "${FAKE[@]}" pnpm --filter @enu/web exec next dev --port "$WEB_PORT" >"$RUN/web.log" 2>&1 &
echo $! >"$RUN/web.pid"

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$RT_PORT/healthz" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$WEB_PORT/api/healthz" >/dev/null 2>&1; then
    echo "demo stack ready: http://localhost:$WEB_PORT (clock offset ${OFFSET}s; logs in $RUN)"
    exit 0
  fi
  sleep 2
done
echo "demo stack did not start; see $RUN/*.log" >&2
exit 1
