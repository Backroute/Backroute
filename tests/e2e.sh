#!/bin/bash
# Runs end-to-end suites against a fresh start (tests/start.sh). With no names, all of them, in order (real-e2e first:
# it makes the carrier the others use). Each suite's output is in tests/.out/logs/<name>.log. KEEP=1 leaves everything running.
source "$(dirname "$0")/common.sh"
ALL="real-e2e channels-e2e approve-e2e dispatch-e2e dispatch-ui autonomy-e2e boards-e2e smart-e2e roadside-e2e rules-e2e care-e2e money-e2e negotiate-e2e replies-e2e language-e2e fleet-e2e voice-e2e support-ui sandbox-e2e ivr-e2e history-e2e sim-e2e human-e2e handsoff-e2e gaps-e2e portal-e2e pilot-e2e natural-e2e ux-e2e ux2-e2e qa-fixes ux3-e2e ux4-e2e ux5-e2e errors-e2e solo-e2e leave-e2e"
SUITES="${*:-$ALL}"
bash "$T/start.sh" || exit 1
failed=0
total_pass=0
total_fail=0
for s in $SUITES; do
  timeout 900 node "$T/e2e/$s.cjs" > "$T/.out/logs/$s.log" 2>&1
  code=$?
  # Every suite prints a PASS or FAIL line per check; a suite that stopped early exits non-zero.
  p=$(grep -c "^PASS" "$T/.out/logs/$s.log")
  f=$(grep -c "^FAIL" "$T/.out/logs/$s.log")
  total_pass=$((total_pass + p))
  total_fail=$((total_fail + f))
  note=""
  [ $code -ne 0 ] && [ $f -eq 0 ] && note=" (stopped: $(grep -m1 -E "Error" "$T/.out/logs/$s.log" | cut -c1-120))"
  printf "%-16s %3d passed, %d failed%s\n" "$s" "$p" "$f" "$note"
  { [ $f -gt 0 ] || [ $code -ne 0 ]; } && failed=1
  # real-e2e makes the carrier every other suite uses: past a failure there, theirs would only be noise.
  if [ "$s" = real-e2e ] && { [ $f -gt 0 ] || [ $code -ne 0 ]; } && [ "$SUITES" != real-e2e ]; then
    echo "real-e2e didn't finish setting up the test carrier, so the other suites weren't run (tests/.out/logs/real-e2e.log)."
    break
  fi
done
echo "All: $total_pass passed, $total_fail failed"
[ -z "$KEEP" ] && stop_all
exit $failed
