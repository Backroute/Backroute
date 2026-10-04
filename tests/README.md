# Tests

Everything runs on one machine against **stand-ins**: small local servers that answer like Claude, Twilio, Postmark,
the ELDs, the load boards, QuickBooks and the rest (`fakes/servers.cjs`). Nothing reaches a real service.

## Commands

Run `npm run test:setup` once per machine. It makes the test keys, downloads PostgREST, and creates the local
Postgres cluster. It needs Postgres 16 and openssl.

| Command | When | Time |
|---|---|---|
| `npm run test:unit` | After every change: types, lint, unit tests | ~35 s |
| `npm run test:quick` | Before pushing: the unit check, plus the main end-to-end paths and the demo | ~15 min |
| `npm run test:e2e` | Before a release: every end-to-end suite, in order | ~2 h |
| `npm run test:e2e -- real-e2e ux5-e2e` | Some suites (start with `real-e2e`; a suite may also need the ones before it in `e2e.sh`) | varies |
| `npm run test:rls` | After changing a migration: the database's access rules | seconds |
| `npm run test:offline` | After changing the service worker: offline on the built app | ~2 min |

Each suite's output is in `tests/.out/logs/<name>.log`, and screenshots are in `tests/.out/`. Neither is committed.

## What's where

- `unit/`: plain checks of the app's logic, run with `tsx`. No database or browser.
- `e2e/`: end to end against the app (dev server on 3210), the stand-ins and a fresh database. `real-e2e` runs
  first: it signs up the carrier the other suites use.
- `fakes/`: the stand-ins, their settings (`env.sh`, all test values), and test files (`data/`).
- `pgrst/`: PostgREST settings and a small proxy that stands in for Supabase's gateway.
- `db/`: rebuilding the database from `supabase/migrations` (every file in order, so a new migration is
  picked up on its own), and the access-rule tests.

## Adding a test

- **Unit:** add `unit/<name>.mts`. Import the app with relative paths (`../../src/lib/...`), and end with a
  `N passed, M failed` line. `npm run test:unit` picks it up.
- **End to end:** add `e2e/<name>.cjs`, using the helpers at the top of an existing suite (`ux5-e2e.cjs` is a
  recent one), and add its name to the list in `e2e.sh`.
- **A new outside service:** answer it in `fakes/servers.cjs` on port 3009, and point its setting at it in `fakes/env.sh`.

## Notes

- Don't edit app code while a suite is running: the dev server reloads and the run fails partway.
- `test:rls` drops the end-to-end database (they share roles). `test:e2e` and `test:quick` rebuild it.
