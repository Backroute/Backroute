#!/bin/bash
# The fast check, a couple of minutes: types, lint, and the unit tests (no database or browser).
source "$(dirname "$0")/common.sh"
cd "$ROOT"
set -o pipefail
echo "Types…" && npx tsc --noEmit -p . || exit 1
echo "Lint…" && npx eslint src --quiet || exit 1
# A few unit tests ask the stand-ins (weather, Places, parking); start them if they aren't up.
started=""
curl -s -o /dev/null localhost:3009 || { (cd "$T" && setsid nohup node fakes/servers.cjs > .out/logs/stand-ins.log 2>&1 &); started=1; sleep 1; }
failed=0
for f in "$T"/unit/*.mts "$T"/unit/*.ts; do
  out=$(bash -c "source '$T/fakes/env.sh'; unset SUPABASE_SERVICE_ROLE_KEY; npx tsx --conditions=react-server '$f'" 2>&1)
  line=$(echo "$out" | grep -E "passed, [0-9]+ failed|all ok" | tail -1)
  printf "%-18s %s\n" "$(basename "$f")" "${line:-$(echo "$out" | tail -1)}"
  echo "$line" | grep -qE ", 0 failed|all ok" || failed=1
done
out=$(node "$T/unit/sw-unit.cjs" 2>&1 | tail -1); printf "%-18s %s\n" "sw-unit.cjs" "$out"; grep -q ", 0 failed" <<< "$out" || failed=1
[ -n "$started" ] && fuser -k 3009/tcp 3021/tcp 3022/tcp 3005/tcp 3006/tcp 3007/tcp 3008/tcp >/dev/null 2>&1
exit $failed
