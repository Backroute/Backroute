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
| Red (`--accent-danger`) | Wrong right now: a breakdown, a missed pickup, a risky broker, a loss. | A small dot or the word |
| Orange (`--accent-warn`) | Waiting on the owner or driver. | A small dot |
| Green (`--accent-live`) | Done or paid. | A small dot or check |

- Two strengths of each status colour. Dots and solid fills use the bright ones (`--dot-live` #06C167,
  `--dot-warn` #FC823A, `--dot-danger` #F83446). Small text uses the darker `--accent-*` versions, which keep the
  contrast.
- Status never fills a block. Pills are grey with a dot (`lib/status.ts`, `components/ui/badge.tsx`); cards have no
  coloured stripes or borders. The `*-soft` tokens are grey on purpose.
- One black button per screen or card. Everything else is a grey button (`variant="secondary"`) or a plain link.
- Dark panels (`.theme-ink`) and the best card (`.theme-invert`) flip the greys; inside them "white" is the panel's
  colour, so a light shape inside one uses a literal (`bg-[#ffffff]`) or the action token.
- Headers are solid, never see-through, so nothing scrolls visibly underneath them.
- No "Live" labels and no pulsing dots for things that are simply on.

## Type

Inter for everything, with its optical sizes (big headings get the display cut), the closest free match to Uber
Move; Geist Mono only for load IDs and number columns. Body text is a hair tighter than Inter's default (-0.011em).

| Where | Sizes |
| --- | --- |
| Website | Headline 84/44px weight 700, letters pulled in 3%; sections 52/32px 700; lead 21/18px; body 17px |
| Owner dashboard | Page title 30px/700; big numbers 28–48px/700; row titles 16px/600; body 15px; smallest 13px |
| Driver app | Large title 34px/700; key numbers 28px/700; body and buttons 17px; smallest 15px; buttons 56px tall |

Nothing smaller than 12px anywhere. Headings are bold and tight; small labels are 12px semibold capitals.
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

Awwwards-style, held back to a few strong moments, and never at the cost of speed or of reading the page:

- **The opening scene** (`components/landing/route-scene.tsx`): a dark map of US freight lanes in 3D (three.js through
  React Three Fiber), one truck running a sample day (Memphis, Indianapolis, Kansas City, Dallas) with a green beam over
  its next pickup. The camera leans with the mouse and lifts as the page scrolls. Shapes only, no model files. It loads
  after the page, draws nothing while scrolled away, holds still for "reduce motion", and a flat drawing of the lanes
  stands in where 3D can't run or the phone asked to save data. A line of what the dispatcher is doing changes under it
  every few seconds, marked "Sample day".
- **One load, start to paid** (`load-story.tsx`): the four steps stay pinned while the page scrolls, and the screen next
  to them changes with each (loads ranked, the broker call, the trip, the paid invoice). On a phone they simply stack.
- **What does that load really pay?** (`load-math.tsx`): sliders for the rate, loaded and empty miles, diesel and mpg;
  what's kept and the rates per mile roll to their new numbers. Nothing leaves the page.
- Cards lean toward the mouse (`TiltCard`), sections rise in as they scroll into view (`Reveal`), and the tools it works
  with run past in a slow line (`Marquee`). All of it is off for "reduce motion" and on touch screens where it would get
  in the way.
- Shared links show a card made by the site (`app/opengraph-image.tsx`); `sitemap.xml` and `robots.txt` list the public
  pages and keep the apps out of search. Contact: hello@backroute.pro.
