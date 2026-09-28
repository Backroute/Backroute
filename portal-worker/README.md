# The browser worker

The AI dispatcher's hands on other companies' websites: it signs rate cons in DocuSign and brokers' portals, fills
carrier setups (MyCarrierPackets, RMIS, Highway...) and books dock appointments on scheduling sites (Opendock, C3...).

It holds no carrier data and decides nothing. It takes a job from the app, opens the link in a fresh browser, and on
every page sends the app what's there (the text, the things you can click or type in, a screenshot). The app
(`src/lib/portal/step.ts`) has the AI pick one action, checks it, and sends it back. Passwords come only inside the
action that types them, for the website they belong to, and are never logged or written to disk.

## Running it

```sh
npm install
APP_URL=https://your-app PORTAL_WORKER_SECRET=... npm start
```

Or build the `Dockerfile` (Playwright's image, with the matching Chromium). Settings:

| Variable | What it's for |
| --- | --- |
| `APP_URL` | The app |
| `PORTAL_WORKER_SECRET` | Shared with the app |
| `WORKER_ID` | A name for this worker (default: host and process) |
| `WORKER_CONCURRENCY` | Jobs at once (default 2) |
| `POLL_SECONDS` | How often to ask for work when idle (default 10) |
| `TASK_MAX_MINUTES` | Longest a job may take, waiting on the owner included (default 45) |
| `CHROMIUM_PATH` | A Chromium to use instead of Playwright's |
| `CHROMIUM_ARGS` | Extra Chromium flags, each starting with `--` |
| `HEADLESS=0` | Show the browser (for watching a real-site run on your own machine) |
| `PORT` | Health check (default 8081) |
| `ALLOW_PRIVATE_HOSTS=1` | Tests only: lets the browser open localhost |

The browser never opens the machine's own network (localhost, private addresses, cloud metadata), whatever a link
says.

## How a job goes

1. A broker's email has the link (a DocuSign envelope, a setup invite, a scheduling page). The app queues a job
   (`portal_tasks`) if the carrier's owner switched on **Settings → Broker websites → Let the AI do these itself**.
2. The worker takes it and opens the link. Each page goes to the app; each answer is one click, one field, one
   upload, a key, a scroll or a wait.
3. **The binding click** (Finish, Submit, Book) only goes through when it's safe:
   - a signature: the rate the AI read on the page matches what was agreed (or the PDF already matched); a different
     rate stops it, the broker is asked to fix it, and the owner is told
   - a carrier setup: the owner said yes on Needs you (with a screenshot of the filled form), or turned on the rule
   - a dock appointment: the slot is inside the load's window
   A screenshot from just before is kept with the load.
4. **What it doesn't know it asks the owner once**: a login, a tax ID, bank details, a code texted to them. Answers are
   encrypted (`portal_logins`) and reused. Codes a site emails go to the carrier's AI address and are typed in
   automatically.
5. **When the site beats it** (stuck, three failed tries, 60 steps, or no worker picked it up in 20 minutes), a
   signing asks the broker for a PDF; anything else goes to support with the link, the steps and the last screenshot.

While a job waits on the owner, the worker keeps the page open for 30 minutes, then lets go; the job starts over from
the link when they answer.

## Before real carriers: trying each site

Everything above is tested against stand-in sites (`portal-e2e`, 45 checks). The real sites haven't been tried. For
each, with a test carrier (its switch on, a real signer name, its own papers) and the worker running with
`HEADLESS=0` on your machine so you can watch:

| Site | How to get a real job | What to watch |
| --- | --- | --- |
| DocuSign | Send yourself an envelope from a free DocuSign developer account, with a rate con PDF and Sign and Initial tags, to the carrier's AI address | Consent box, Start/Next through every tag, the Adopt Your Signature box, Finish, the download |
| Adobe Acrobat Sign | Same, from a free Acrobat Sign trial | The Start arrow, typed signature, "Click to Sign" |
| Dropbox Sign, PandaDoc | Same, from their trials | Signature box, Insert, finishing |
| MyCarrierPackets | Ask a friendly broker who uses it to invite the test carrier | Sign-in vs. new account, the emailed code, which fields it wants, the agreement, the submit waiting for the owner |
| RMIS | Same, with a broker on RMIS | The carrier login, insurance agent questions (the AI must ask, not guess) |
| Highway | Same, with a broker on Highway | Identity checks: a phone code is asked of the owner; a selfie must stop and go to support |
| Opendock, C3 | A shipper or broker who uses one, or their demo sites | Warehouse and dock choice, time zone of the slots, the confirmation number |

For each run, check:

- It did the job, and the result is on the load (signed at, the signed PDF, the appointment and confirmation).
- The screenshot before the binding click shows the right document or form.
- The job's steps (support console, or `portal_tasks.data.steps`) have no password, code or private number in them.
- Anything it asked the owner was a real gap, asked once.

When a site trips it, add what you learned to `SITE_HINTS` in `src/lib/portal/step.ts` (the AI reads them on that
site), and run it again. Start with the switch on for one carrier, and watch the support console's Numbers tab for
what still goes to people.
