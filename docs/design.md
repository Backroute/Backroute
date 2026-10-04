# How Backroute looks and talks

The rules behind the website, the owner dashboard and the driver app. The colours and type live in
`src/app/globals.css`; this page says how to use them.

## Colour

Apple's palette: cool greys, near-black text (`#1D1D1F`), and one blue for the thing to tap.

| Colour | Means | Shows as |
| --- | --- | --- |
| Black and grey | Almost everything: text, numbers, icons, cards. Money is black, never green. | Text |
| Blue (`--action`) | Something to tap: the main button on a screen, links, a switch that's on, keyboard focus. | Button or link |
| Red (`--accent-danger`) | Wrong right now: a breakdown, a missed pickup, a risky broker, a loss. | A small dot or the word |
| Orange (`--accent-warn`) | Waiting on the owner or driver. | A small dot |
| Green (`--accent-live`) | Done or paid. | A small dot or check |

- Two strengths of each status colour. Dots and solid fills use Apple's bright system colours (`--dot-live` #34C759,
  `--dot-warn` #FF9500, `--dot-danger` #FF3B30), so orange and red are easy to tell apart even at 6px. Small text uses the
  darker `--accent-*` versions, which keep the contrast.
- Status never fills a block. Pills are grey with a dot (`lib/status.ts`, `components/ui/badge.tsx`); cards have no
  coloured stripes or borders. The `*-soft` tokens are grey on purpose.
- One blue button per screen or card. Everything else is a grey button (`variant="secondary"`) or a plain link.
- Dark panels (`.theme-ink`) use the bright versions of the status colours, as iOS does in dark mode.
- No "Live" labels and no pulsing dots for things that are simply on.

## Type

Geist for everything; Geist Mono only for small labels (`t-label`), load IDs and number columns.

| Where | Sizes |
| --- | --- |
| Website | Headline 104/48px weight 500, letters pulled in 4.5%; sections 56/34px weight 500; lead 22/19px; body 17px |
| Owner dashboard | Page title 30px/600; big numbers 34px/500; row titles 15px/600; body 15px; smallest 13px |
| Driver app | Large title 34px/700; key numbers 28px/600; body and buttons 17px; smallest 15px; buttons 56px tall |

Nothing smaller than 12px anywhere. Big text gets lighter and tighter, not bolder.

A lane on screen is `<Lane from to />` (`components/ui/lane.tsx`): an arrow icon as heavy as the text, never the thin
"→" character. Plain strings (CSV, texts, emails) keep the character.

## Load cards

`components/shared/load-offer-card.tsx`, the same card for owners and drivers, in a row you swipe or step through with
the arrows (`components/shared/offer-rail.tsx`: never moves on its own, the next card peeks in, "1 of 3" says how many).

- The best load is first and the opposite colour of the page (`.theme-invert`: dark on a light page, light on a dark
  one), with a blue "Best fit" tag on its top edge.
- Top: broker, equipment and weight; the fit score as a number in a ring, nothing else.
- The trip: a dot, a line and a ring with the cities, and on the right each stop's date and the dock's hours in the
  dock's own time zone ("Mon, Oct 5" / "7 am–4 pm EDT", from `lib/load-dates.ts`); "today" or "tomorrow" under the city.
- Three facts in fixed places: the miles they'll drive (empty to pickup plus loaded), the drive time, and the reload.
- The money: the load's rate is the big number, because it's what the load pays and a smaller figure reads as a worse
  load; beside it the rate per mile and what's left after costs. Details lists every cost (fuel, tolls, empty miles, the
  2% fee) down to what's left.
- The whole card, button included, fits on an iPhone SE screen without scrolling.
- One reason, one blue button.

## Notifications

- One number in the whole owner dashboard: what needs the owner, on the Home tab. The bell is a quiet history.
- Pop-ups only for what can't wait (`isUrgent` in `lib/alerts.ts`): safety, a decision that's blocking, a load lost.
  One at a time; on phones they drop in under the top bar like iPhone banners.
- Nothing pops up in driving mode (`[data-driving] .hide-when-driving`).
- Anything that covers the whole screen (driving mode, calls, sheets) renders through `components/ui/portal.tsx`, so a
  page's own layers can never sit on top of it. `tests/e2e/demo-smoke.cjs` fails if anything covers driving mode.

## Words

- Say what happened and lead with the number: "Coastal offered $1,130, $112 under your floor. Take it or walk?"
- Don't say "AI" on screen; say "Backroute" when something needs a name, or just say what was done.
- Buttons are a verb and an object: "Select this load", "Book it", "Ask a person".
- Trucking's own words stay: load, lane, rate con, POD, deadhead, detention, TONU.
- On the website: headlines of three to six words that say what the customer gets; only real numbers, and a sample
  is labelled as one.
