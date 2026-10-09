import { House, Truck, UsersRound, Wallet } from "lucide-react";

/**
 * The owner's phone on the website, drawn as an iPhone 18 Pro in Silver: the aluminum unibody frame, thin even black
 * bezels, the smaller Dynamic Island, the buttons on both sides (Action and volume on the left, the side button and
 * Camera Control on the right), and an iOS status bar and home indicator. Markup rather than a picture, so it stays
 * sharp at any size and uses the app's real type and colours.
 */
const METAL = "linear-gradient(145deg, #f7f8fa 0%, #c9cdd3 22%, #eef0f3 48%, #b5bac1 74%, #e8eaee 100%)";

/** Left: Action button, volume up, volume down. Right: side button, Camera Control. */
const BUTTONS: { side: "left" | "right"; top: string; height: string }[] = [
  { side: "left", top: "18%", height: "7%" },
  { side: "left", top: "27%", height: "11%" },
  { side: "left", top: "40%", height: "11%" },
  { side: "right", top: "26%", height: "15%" },
  { side: "right", top: "57%", height: "9%" },
];

export function PhonePreview() {
  return (
    <div aria-hidden className="relative mx-auto w-[19.5rem] max-w-full select-none [zoom:0.8] sm:[zoom:1]">
      {BUTTONS.map((b, i) => (
        <span
          key={i}
          className="absolute w-[3px] rounded-full"
          style={{ [b.side]: -2, top: b.top, height: b.height, background: METAL, boxShadow: "inset 0 0 0 0.5px rgb(0 0 0 / 0.18)" }}
        />
      ))}

      {/* The aluminum frame, then the black border around the glass. */}
      <div
        className="rounded-[3.35rem] p-[3px]"
        style={{ background: METAL, boxShadow: "inset 0 0 0 0.5px rgb(255 255 255 / 0.9), 0 50px 80px -30px rgb(0 0 0 / 0.45), 0 20px 30px -20px rgb(0 0 0 / 0.25)" }}
      >
        <div className="rounded-[3.2rem] bg-[#0b0b0c] p-[6px]">
          <div className="relative aspect-[402/874] overflow-hidden rounded-[2.85rem] bg-[#f3f3f3] text-black">
            {/* Dynamic Island: about a third narrower than on earlier Pro models. */}
            <span className="absolute left-1/2 top-[1.6%] h-[3.4%] w-[24%] -translate-x-1/2 rounded-full bg-black" />

            <div className="flex items-center justify-between px-[9%] pt-[4.4%] text-[13px] font-semibold tracking-tight">
              <span>9:41</span>
              <span className="flex items-center gap-1">
                <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
                  <rect x="0" y="7" width="3" height="4" rx="0.8" />
                  <rect x="4.3" y="5" width="3" height="6" rx="0.8" />
                  <rect x="8.6" y="2.6" width="3" height="8.4" rx="0.8" />
                  <rect x="12.9" y="0" width="3" height="11" rx="0.8" />
                </svg>
                <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
                  <path d="M7.5 2.2c2.2 0 4.2.8 5.7 2.2l1.1-1.1A9.6 9.6 0 0 0 7.5.6 9.6 9.6 0 0 0 .7 3.3l1.1 1.1a8 8 0 0 1 5.7-2.2Z" />
                  <path d="M7.5 5.3c1.3 0 2.5.5 3.5 1.3l1.1-1.1a6.6 6.6 0 0 0-9.2 0L4 6.6c1-.8 2.2-1.3 3.5-1.3Z" />
                  <path d="M7.5 8.3c.5 0 .9.2 1.3.5L7.5 10.1 6.2 8.8c.4-.3.8-.5 1.3-.5Z" />
                </svg>
                <span className="relative ml-0.5 flex h-[11px] w-[23px] items-center rounded-[3.5px] border border-black/40 p-[1.5px]">
                  <span className="h-full w-[80%] rounded-[1.5px] bg-black" />
                  <span className="absolute -right-[3px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r bg-black/40" />
                </span>
              </span>
            </div>

            <div className="px-[5.5%] pt-[9%]">
              <p className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Good morning</p>
              <p className="mt-0.5 text-[13px] text-[#5e5e5e]">1 needs you · $3,129 profit this week</p>

              <div className="mt-4 rounded-[14px] bg-[#ffffff] p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#fc823a]" /> Book Marcus to Kansas City?
                </p>
                <p className="mt-1 text-[12px] leading-snug text-[#5e5e5e]">Coastal Freight agreed $1,107, above your $1,050 floor. Pickup today, 2 pm.</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="rounded-lg bg-black px-4 py-1.5 text-[13px] font-semibold text-[#ffffff]">Book it</span>
                  <span className="text-[13px] font-semibold text-[#5e5e5e]">Not this one</span>
                </div>
              </div>

              <p className="mb-1.5 mt-5 px-1 text-[12px] font-medium uppercase tracking-wide text-[#5e5e5e]">Trucks</p>
              <ul className="overflow-hidden rounded-[14px] bg-[#ffffff] text-[13px]">
                {[
                  ["T-104 · Marcus", "Indianapolis, 5 h"],
                  ["T-107 · Rosa", "Next load booked"],
                  ["T-112 · Corey", "At pickup, Memphis"],
                ].map(([truck, where], i) => (
                  <li key={truck} className={`flex items-center justify-between gap-2 px-3.5 py-2.5 ${i ? "border-t border-[#e8e8e8]" : ""}`}>
                    <span className="font-medium">{truck}</span>
                    <span className="truncate text-[#5e5e5e]">{where}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-[5.5%] pt-4">
              <div className="flex items-center justify-between rounded-[14px] bg-[#ffffff] px-3.5 py-3">
                <div>
                  <p className="text-[12px] text-[#5e5e5e]">Booked this week</p>
                  <p className="text-[20px] font-semibold tracking-tight">$18,940</p>
                </div>
                <div className="flex h-9 items-end gap-[3px]">
                  {[40, 55, 35, 70, 60, 85, 100].map((h, i) => (
                    <span key={i} className="w-[5px] rounded-full bg-black" style={{ height: `${h}%`, opacity: i === 6 ? 1 : 0.18 }} />
                  ))}
                </div>
              </div>
            </div>

            {/* The app's tab bar, frosted, above the home indicator. */}
            <div className="absolute inset-x-0 bottom-0 flex justify-around border-t border-black/5 bg-[#ffffff]/85 px-4 pb-[7%] pt-2 text-[12px] font-medium text-[#727272] backdrop-blur">
              {([["Home", House], ["Loads", Truck], ["Fleet", UsersRound], ["Money", Wallet]] as const).map(([t, Icon], i) => (
                <span key={t} className={`flex flex-col items-center gap-0.5 ${i === 0 ? "text-black" : ""}`}>
                  <Icon className="h-[20px] w-[20px]" strokeWidth={i === 0 ? 2.2 : 1.8} />
                  {t}
                </span>
              ))}
            </div>
            <span className="absolute bottom-[1.2%] left-1/2 h-[5px] w-[36%] -translate-x-1/2 rounded-full bg-black" />
          </div>
        </div>
      </div>
    </div>
  );
}
