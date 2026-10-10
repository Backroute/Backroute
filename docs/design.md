# How Backroute looks and talks

The rules behind the website, the owner dashboard and the driver app. The colours and type live in
`src/app/globals.css`; this page says how to use them.

## Colour

After Uber's Base design system (its open-source tokens): black and white with true greys, high contrast so it
reads in a truck cab at noon.

| Colour | Means | Shows as |
| --- | --- | --- |
| Black and grey | Almost everything: text, numbers, icons, cards. Money is black, never green. Greys are Base's (#F3F3F3 panels, #E8E8E8 lines, #4B4B4B and #5E5E5E secondary text). | Text |
| Black (`--action`, white in dark mode) | The thing to tap: the main button on a screen, a switch that's on. | Button |
| Blue (`--link`, #276EF1) | Text links, keyboard focus, the "Best fit" tag and what kind of plan a card is. | Link or tag |
| Red (`--accent-danger`) | Wrong right now: a breakdown, a missed pickup, a risky broker, a loss. | A filled circle with a "!", or the word |
| Orange (`--accent-warn`) | Waiting on the owner or driver. | A ring (hollow) |
| Green (`--accent-live`) | Done or paid. | A small dot or check |

- Two strengths of each status colour. Dots and solid fills use the bright ones (`--dot-live` #06C167,
  `--dot-warn` #FC823A, `--dot-danger` #F83446). Small text uses the darker `--accent-*` versions, which keep the
  contrast.
- Red and orange never differ by colour alone: at dot size they look alike, and some owners are colour-blind. Every
  status mark comes from `StatusMark` (`components/ui/mark.tsx`): a red filled circle with a "!" for needs you now, an
  orange ring for waiting, and plain dots for green, black and grey. An urgent card (`AttentionCard tone="urgent"`)
  also says "Urgent" in red, has a red edge, and goes to the top of the list. The phone tab count is a filled red
  bubble when something is urgent, an orange ring when things are only waiting.
- Urgent cards carry their answer when there is one ("Take it" / "Walk away"), so the owner decides on the card.
- Contact is one tap wherever a load is open (`components/shared/contact-row.tsx`): Call, Text and Message the driver,
  Call the broker. A destructive action (Cancel load) lives in the "…" menu, not out in the open.
- A section shows three tabs at most so they fit a phone; more pages go in a switch under the tab (carrier layout).
- Status never fills a block. Pills are grey with a mark (`lib/status.ts`, `components/ui/badge.tsx`); cards have no
  coloured stripes, and only an urgent card has a coloured border. The `*-soft` tokens are grey on purpose.
- One black button per screen or card. Everything else is a grey button (`variant="secondary"`) or a plain link.
- Dark panels (`.theme-ink`) and the best card (`.theme-invert`) flip the greys; inside them "white" is the panel's
  colour, so a light shape inside one uses a literal (`bg-[#ffffff]`) or the action token.
- Headers are solid, never see-through, so nothing scrolls visibly underneath them.
- No "Live" labels and no pulsing dots for things that are simply on.

## Type

Geist for everything (the owner picked it over Manrope, DM Sans and Plus Jakarta Sans); Geist Mono only for load IDs
and number columns. Light and even: big headings at medium weight with the letters drawn in a little, app headings
semibold, text regular at Geist's own spacing.

| Where | Sizes |
| --- | --- |
| Website | Headline 84/44px weight 500, letters pulled in 4%; sections 52/32px 500; lead 21/18px; body 17px; no bold |
| Owner dashboard | Page title 30px/600; big numbers 28–48px/600; row titles 16px/600; body 15px; smallest 13px |
| Driver app | Large title 34px/600; key numbers 28px/600; body and buttons 17px; smallest 15px; buttons 56px tall |

Nothing smaller than 12px anywhere. Small labels are 12px semibold capitals. On the website, no little boxes or pills
around words: a label is plain grey text.
Buttons are rounded rectangles (12px corners), not pills; chips and tags stay round.

A lane on screen is `<Lane from to />` (`components/ui/lane.tsx`): an arrow icon as heavy as the text, never the thin
"→" character. Plain strings (CSV, texts, emails) keep the character.

## Load cards

`components/shared/load-offer-card.tsx`, the same card for owners and drivers, in a row you swipe or step through with
the round arrows on its left and right edges (`components/shared/offer-rail.tsx`): it never moves on its own, the next card peeks in, the dots underneath show which one is up (tap one to jump), and the arrows sit level with the trip line so they never cover a word.

- The best load is first and the opposite colour of the page (`.theme-invert`: black on a light page, white on a dark
  one), with a blue "Best fit" tag on its top edge.
- Top: broker, equipment and weight; the fit score as a number in a ring, nothing else.
- The trip: a dot, a line and a ring with the cities, and on the right each stop's date and the dock's hours in the
  dock's own time zone ("Mon, Oct 5" / "7 am–4 pm EDT", from `lib/load-dates.ts`); "today" or "tomorrow" under the city.
- Three facts in fixed places: the miles they'll drive (empty to pickup plus loaded), the drive time, and the reload.
- The money: the load's rate is the big number, because it's what the load pays and a smaller figure reads as a worse
  load; beside it the rate per mile and what's left after costs. Details lists every cost (fuel, tolls, empty miles, the
  2% fee) down to what's left.
- The whole card, button included, fits on an iPhone SE screen without scrolling.
- A plan of several loads (back to back, or partials sharing the trailer) is one card: a blue label says what it is
  ("3 loads back to back", "2 loads, one trailer"), every stop is listed in order with "load 1", "load 2", the drive
  between stops says loaded or empty (empty drawn dashed), and a moon marks each overnight rest on a long run. The money
  is the whole plan's; the button says "Book all 3 loads". Multi-stop loads list the extra drop; long single runs say
  "Long run · 3 days". Days and dates come from the driver's legal hours: a team truck says "Team" after the
  equipment and gets there sooner, with no nights.
- One reason, one blue button.

## Lists on a phone

- **Live loads on Home** are one line per truck (`components/owner/live-load-row.tsx`): where it's headed, how it's
  going on the right ("To delivery · 3 h 10 min", "At the shipper", red "Late · ETA" with the red "!" mark), the truck,
  driver and load number under it, and a thin bar for how far along. Empty trucks come last, grey, with Choose and
  Auto-pick on the line. The full trip opens from a tap.
- **Today's stops** put the time on top and the date under it in the left column, and the place, the truck and the
  status each on their own line, so nothing is cut off. Stops with no clock time come after the day's timed ones.
- **A page whose content needs the room** (Messages) uses `PageHeader compact`: a slim header on a phone, its
  description from tablet up. The thread fills the screen down to the tab bar and scrolls by itself; the page doesn't.
- **The load page leads with what the stage needs:** the deal while it's being won, then the papers, the load sheet, the
  stops and the driver once it's booked, then getting paid once delivered (`sectionOrder` on the load page).

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

## The website's motion

Calm and classy: black and white, big type, the product itself as the picture, and motion only where it explains
something. No 3D.

- **The top**: the headline beside the owner's phone (`components/landing/phone-preview.tsx`), with one quiet card
  next to it that changes every few seconds to show what the dispatcher is doing for a truck (`live-feed.tsx`, marked
  "Sample day"). The tools it works with are named underneath, in plain text.
- **One load, start to paid** (`load-story.tsx`): the four steps stay pinned while the page scrolls, and the screen next
  to them changes with each (loads ranked, the broker call, the trip, the paid invoice). On a phone they simply stack.
- **What does that load really pay?** (`load-math.tsx`): sliders for the rate, loaded and empty miles, diesel and mpg;
  what's kept and the rates per mile roll to their new numbers. Nothing leaves the page.
- Sections rise in gently as they scroll into view (`Reveal`). All motion is off for "reduce motion".
- Shared links show a card made by the site (`app/opengraph-image.tsx`); `sitemap.xml` and `robots.txt` list the public
  pages and keep the apps out of search. Contact: hello@backroute.pro.
