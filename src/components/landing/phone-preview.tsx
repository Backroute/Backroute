/**
 * A still picture of the owner's phone: the morning summary and the one thing waiting. Drawn in markup (not a
 * screenshot) so it stays sharp, matches the app's real type and colours, and needs no image to load.
 */
export function PhonePreview() {
  return (
    <div aria-hidden className="mx-auto w-[min(100%,20rem)] rounded-[2.75rem] bg-ink-950 p-2.5 shadow-[0_40px_80px_-24px_rgb(0_0_0/0.35)]">
      <div className="overflow-hidden rounded-[2.25rem] bg-white">
        <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[12px] font-semibold text-ink-950">
          <span>7:42</span>
          <span className="h-5 w-20 rounded-full bg-ink-950" />
          <span className="tabular">100%</span>
        </div>
        <div className="px-5 pb-6 pt-4">
          <p className="text-[26px] font-semibold leading-tight tracking-tight text-ink-950">Good morning</p>
          <p className="mt-0.5 text-[13px] text-ink-500">1 needs you · $3,129 profit this week</p>

          <div className="mt-5 rounded-2xl border border-line p-3.5">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-950">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-warn)]" /> Book Marcus to Kansas City?
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink-500">Coastal Freight agreed $1,107, above your $1,050 floor. Pickup today, 2 pm.</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="rounded-full bg-[var(--action)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--action-ink)]">Book it</span>
              <span className="text-[12px] font-medium text-ink-500">Not this one</span>
            </div>
          </div>

          <p className="mt-6 text-[12px] font-medium text-ink-400">Trucks</p>
          <ul className="mt-2 flex flex-col divide-y divide-line text-[12px]">
            {[
              ["T-104 · Marcus", "Indianapolis, 5 h"],
              ["T-107 · Rosa", "Delivered, next load booked"],
              ["T-112 · Corey", "At pickup, Memphis"],
            ].map(([truck, where]) => (
              <li key={truck} className="flex items-center justify-between gap-2 py-2">
                <span className="font-medium text-ink-950">{truck}</span>
                <span className="truncate text-ink-500">{where}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
