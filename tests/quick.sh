#!/bin/bash
# After a change, about 15 minutes: the unit check, then the main end-to-end paths (sign-up and the real fleet,
# broker email to booking, the newest round's trip/parking/QuickBooks flows, and the demo in a browser).
source "$(dirname "$0")/common.sh"
bash "$T/unit.sh" || exit 1
# Suites build on the ones before them (the carrier, its drivers, its brokers), so these keep the full run's order.
bash "$T/e2e.sh" real-e2e channels-e2e approve-e2e dispatch-e2e ux5-e2e || exit 1
# The demo, on its own dev server.
(cd "$ROOT" && setsid nohup npx next dev -p 3300 > "$T/.out/logs/demo-dev.log" 2>&1 < /dev/null &)
until curl -sf -o /dev/null localhost:3300/; do sleep 2; done
node "$T/e2e/demo-smoke.cjs" > "$T/.out/logs/demo-smoke.log" 2>&1; r=$?
fuser -k 3300/tcp >/dev/null 2>&1
printf "%-16s %s\n" demo-smoke "$(tail -1 "$T/.out/logs/demo-smoke.log")"
exit $r
