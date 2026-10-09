#!/bin/bash
# A fresh database, the stand-ins, and the app (dev server on 3210) with the stand-ins' settings.
set -e
source "$(dirname "$0")/common.sh"
stop_all
bash "$T/db/rebuild.sh"
cd "$T"
rm -f fakes/ratecon.json fakes/feed2.json
(setsid nohup "$T/.out/postgrest" pgrst/pgrst.conf > .out/logs/postgrest.log 2>&1 &)
(setsid nohup node fakes/servers.cjs > .out/logs/stand-ins.log 2>&1 &)
(setsid nohup node fakes/portals.cjs > .out/logs/portals.log 2>&1 &)
(setsid nohup node pgrst/proxy.cjs > .out/logs/proxy.log 2>&1 &)
sleep 2
(cd "$ROOT" && source "$T/fakes/env.sh" && setsid nohup npm run dev -- -p 3210 > /tmp/nextdev.log 2>&1 < /dev/null &)
until curl -sf localhost:3210/api/channels/status >/dev/null; do sleep 2; done
# Warm the pages the browser tests open, so a first compile doesn't time a test out.
for p in login signup carrier carrier/loads carrier/settings driver ops; do curl -s -o /dev/null --max-time 180 "localhost:3210/$p"; done
echo "App and stand-ins up"
