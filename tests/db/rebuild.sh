#!/bin/bash
# The app's database from scratch for the end-to-end tests: Supabase's pieces (shim-rest.sql), then every migration
# in supabase/migrations in order. A new migration is picked up on its own.
set -e
source "$(dirname "$0")/../common.sh"
pg_up
pg -c "'drop database if exists rest with (force)'" 2>&1 | grep -v NOTICE || true
pg -c "'drop database if exists t with (force)'" 2>&1 | grep -v NOTICE || true
for r in anon authenticated authenticator service_role; do pg -c "'drop owned by $r'" -c "'drop role if exists $r'" >/dev/null 2>&1 || true; done
pg -c "'create database rest'"
pg -d rest -v ON_ERROR_STOP=1 -f "$T/db/shim-rest.sql"
for m in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do pg -d rest -v ON_ERROR_STOP=1 -f "$m" >/dev/null; done
pg -d rest -c "\"insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001','12145550100'), ('dddddddd-0000-0000-0000-000000000003','12145550148')\""
echo "Database rebuilt ($(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations)"
