# Shared by the test scripts: where things are, and the local test database.
T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$T/.." && pwd)"
PGDIR="${PGDIR:-/var/lib/postgresql/backroute-test}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT=55432
# Runs psql as the postgres user against the test cluster.
pg() { su postgres -c "$PGBIN/psql -h $PGDIR -p $PGPORT -U postgres -q $*"; }
pg_up() {
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR/data status" >/dev/null 2>&1 ||
    su postgres -c "$PGBIN/pg_ctl -D $PGDIR/data -o '-p $PGPORT -k $PGDIR' -l $PGDIR/log start" >/dev/null
}
# Every port the app and the stand-ins use.
PORTS="3001/tcp 3002/tcp 3005/tcp 3006/tcp 3007/tcp 3008/tcp 3009/tcp 3013/tcp 3021/tcp 3022/tcp 8091/tcp 3210/tcp 3211/tcp"
stop_all() { fuser -k $PORTS >/dev/null 2>&1 || true; sleep 1; }
# The browser tests use Playwright from the project or, failing that, the machine's global install (where the
# browsers it was installed with live).
export NODE_PATH="$ROOT/node_modules:$(npm root -g 2>/dev/null)${NODE_PATH:+:$NODE_PATH}"
