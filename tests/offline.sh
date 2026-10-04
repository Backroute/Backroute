#!/bin/bash
# Offline on the built app: a production build with the stand-ins' settings, served on 3211, then the driver's
# screen opened with no signal (tests/e2e/offline-prod.cjs). Starts fresh and runs real-e2e first to make the carrier.
source "$(dirname "$0")/common.sh"
KEEP=1 bash "$T/e2e.sh" real-e2e || exit 1
cd "$ROOT" && source "$T/fakes/env.sh" || exit 1
npx next build > "$T/.out/logs/build.log" 2>&1 || { echo "build failed: tests/.out/logs/build.log"; exit 1; }
fuser -k 3210/tcp 3211/tcp >/dev/null 2>&1
(setsid nohup npx next start -p 3211 > "$T/.out/logs/next-start.log" 2>&1 < /dev/null &)
until curl -sf -o /dev/null localhost:3211/login; do sleep 2; done
node "$T/e2e/offline-prod.cjs" > "$T/.out/logs/offline-prod.log" 2>&1; r=$?
stop_all
printf "%-16s %s\n" offline-prod "$(tail -1 "$T/.out/logs/offline-prod.log")"
exit $r
