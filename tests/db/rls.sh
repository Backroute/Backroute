#!/bin/bash
# The database's access rules, checked directly in Postgres (who can read and change what), on a scratch database.
source "$(dirname "$0")/../common.sh"
pg_up
# The roles are shared across databases, so the end-to-end database goes first (tests/start.sh rebuilds it).
pg -c "'drop database if exists rest with (force)'" >/dev/null
pg -c "'drop database if exists t with (force)'" -c "'create database t'"
for r in anon authenticated; do pg -c "'drop owned by $r'" -c "'drop role if exists $r'" >/dev/null 2>&1; done
pg -d t -v ON_ERROR_STOP=1 -f "$T/db/shim.sql" || exit 1
for m in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do pg -d t -v ON_ERROR_STOP=1 -f "$m" >/dev/null || exit 1; done
out=$(pg -d t -f "$T/db/rls-test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR")
echo "$out" | grep -E "FAIL|ERROR"
echo "Access rules: $(echo "$out" | grep -c PASS) passed, $(echo "$out" | grep -cE "FAIL|ERROR") failed"
echo "$out" | grep -qE "FAIL|ERROR" && exit 1 || exit 0
