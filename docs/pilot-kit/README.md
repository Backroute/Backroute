# Pilot kit

Print-ready pages for each pilot carrier, filled in with their details by `scripts/pilot-kit.mjs`:

- `carrier-guide.html`: the owner's one page. What Backroute does, the pilot's stages, the day-one checklist, how to
  pause it and how to reach us.
- `driver-card.html`: the driver's first day and what to text, with four cut-out cab cards (two English, two Spanish).
- `driver-consent-form.html`: the drivers' written consent to texts and calls, from `docs/legal/driver-text-consent.md`.
  It prints marked **DRAFT** with the open questions for counsel; don't hand it to drivers until a lawyer has approved
  the words, then take the marks out here and in `src/lib/consent-words.ts` together.

```sh
node scripts/pilot-kit.mjs --carrier "Lone Star Hauling" --dispatch "(469) 555-0199" \
  --inbound "abc123+k7f2@inbound.postmarkapp.com" --support "(214) 555-0123"
```

The carrier's Backroute address is in their Settings (or `node scripts/pilot-carrier.mjs status <id>`). The output goes
to `pilot-kit/` (not committed): the filled-in HTML, and Letter-size PDFs when Playwright is installed. Anything left out
prints as a blank line to fill in by hand.

When the app's wording changes (the screens named on these pages, the first text, the consent words), change these
pages with it.
