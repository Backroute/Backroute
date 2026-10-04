#!/bin/bash
# Once per machine (safe to run again): the local Postgres cluster, PostgREST, and test keys made on this machine.
# Needs Postgres 16, openssl and the app's node_modules. The keys and downloads go in tests/.out (not committed).
set -e
source "$(dirname "$0")/common.sh"
mkdir -p "$T/.out/logs"

if [ ! -f "$T/.out/keys.sh" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$T/.out/push-key.pem" -out "$T/.out/push-cert.pem" 2>/dev/null
  VAPID=$(cd "$ROOT" && node -e 'const k = require("web-push").generateVAPIDKeys(); console.log(k.publicKey + " " + k.privateKey)')
  {
    echo "export PORTAL_VAULT_KEY=$(openssl rand -base64 32)"
    echo "export NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID% *}"
    echo "export VAPID_PRIVATE_KEY=${VAPID#* }"
  } > "$T/.out/keys.sh"
  echo "Made test keys"
fi

if [ ! -x "$T/.out/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$T/.out"
  echo "Downloaded PostgREST 12.2.3"
fi

if [ ! -d "$T/.out/pylib/cryptography" ]; then
  # One end-to-end check opens the invoice PDF with pypdf, the way a strict PDF reader would.
  pip install -q --target "$T/.out/pylib" pypdf cryptography  # its own cryptography: the system copy can fail to load
  echo "Installed pypdf for the invoice check"
fi

if [ ! -d "$PGDIR/data" ]; then
  mkdir -p "$PGDIR" && chown postgres "$PGDIR"
  su postgres -c "$PGBIN/initdb -D $PGDIR/data -A trust" >/dev/null
  echo "Made the test database cluster in $PGDIR"
fi
pg_up
echo "Ready. Next: npm run test:unit, npm run test:quick, or npm run test:e2e"
