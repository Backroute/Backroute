/**
 * Phone menus and hold, on calls the AI places (brokers, repair shops). A dispatcher calling a brokerage hears "for
 * carrier sales, press 2", presses 2, waits through the hold music without talking, and says who they are again
 * when someone picks up. Decided here in code from what was heard, before the AI answers anything.
 */

export type PhoneTree = { kind: "menu"; digit: string; option: string } | { kind: "hold" } | null;

const WORDS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", star: "*", pound: "#", hash: "#" };
const KEY = String.raw`(\d|\*|#|zero|one|two|three|four|five|six|seven|eight|nine|star|pound|hash)`;
const digitOf = (k: string) => WORDS[k.toLowerCase()] ?? k;

/** The options a menu reads out: "for carrier sales, press 2", "press 3 for accounting", "dispatch, press 4". */
export function menuOptions(heard: string): { digit: string; option: string }[] {
  const out: { digit: string; option: string }[] = [];
  const add = (digit: string, option: string) => {
    const o = option.trim().replace(/^(the|our)\s+/i, "");
    if (o && !out.some((x) => x.digit === digit)) out.push({ digit: digitOf(digit), option: o.toLowerCase() });
  };
  for (const clause of heard.split(/[.;!?\n]|,\s*(?=(?:for|to|if)\b)/i)) {
    let m = clause.match(new RegExp(String.raw`(?:for|to reach|to speak (?:to|with)|if you(?:'re| are)(?: calling)? (?:about|for|a)?)\s+(.+?),?\s+(?:please\s+)?(?:press|dial|say)\s+${KEY}\b`, "i"));
    if (m) {
      add(m[2], m[1]);
      continue;
    }
    m = clause.match(new RegExp(String.raw`(?:press|dial|say)\s+${KEY}\s+(?:for|to(?: reach| speak (?:to|with))?)\s+(.+)`, "i"));
    if (m) {
      add(m[1], m[2]);
      continue;
    }
    m = clause.match(new RegExp(String.raw`^\s*([a-z][a-z &'-]{2,40}),\s+(?:press|dial)\s+${KEY}\b`, "i"));
    if (m) add(m[2], m[1]);
  }
  return out;
}

const HOLD = /\b(please (hold|wait|stay on the line|remain on the line)|hold (on|please|while|for)|one moment,? please|just a (moment|minute|sec(ond)?)|(i'?ll|let me) (transfer|connect|put you through)|transferring (you|your call)|connecting (you|your call)|your call is (important|being transferred)|next available|all (of )?our (agents|representatives|team members|dispatchers) are|estimated (wait|hold) time|you are (caller )?number \d+)\b/i;

/**
 * What to do with what was just heard: press a key on a menu (the option matching `want`, else the operator), wait
 * silently on hold, or nothing special (null) and the AI answers as usual.
 */
export function phoneTree(heard: string, want: RegExp): PhoneTree {
  const options = menuOptions(heard);
  if (options.length) {
    const pick =
      options.find((o) => want.test(o.option)) ??
      // A language menu first: English (the calls are in English).
      options.find((o) => /\benglish\b/.test(o.option)) ??
      options.find((o) => /operator|representative|someone|all other|anything else|front desk|reception|a person/.test(o.option)) ??
      options.find((o) => o.digit === "0");
    return { kind: "menu", digit: pick?.digit ?? "0", option: pick?.option ?? "the operator" };
  }
  // A person saying "hold on" mid-conversation is a hold too, as long as they aren't also asking something.
  if (HOLD.test(heard) && !/\?\s*$/.test(heard.trim())) return { kind: "hold" };
  return null;
}

/** What each kind of call is trying to reach on a company's phone menu. */
export const WANT = {
  broker: /carrier|capacity|dispatch|truck|load|sales|operations|ops\b|track|book|logistics|freight/i,
  shop: /service|repair|road ?side|tow|breakdown|dispatch|emergency|24|mobile|tire/i,
};

/** What the AI does next on a call: say something (maybe nothing), hang up, press keys, or wait quietly on hold. */
export interface CallReply {
  reply: string;
  hangUp: boolean;
  digits?: string;
  hold?: boolean;
  /** On a natural call: the key press went into the call itself, which moved to a new stream. */
  redirected?: boolean;
}

/** Most keys pressed on one call (a menu that keeps coming back), and turns on hold (about 30 seconds each), before giving up. */
export const MAX_PRESSES = 4;
export const MAX_HOLDS = 20;

/**
 * The phone-menu step of a call the AI placed: the menu and hold go in the call's log like anything else said, so the
 * AI knows it went through them when a person picks up. Null when it's a person talking. Stuck in menus, it presses 0
 * for a person; stuck anyway, or on hold too long, it hangs up (and the caller follows up another way).
 */
export async function throughPhoneTree(
  heard: string,
  want: RegExp,
  earlier: { direction: string; data: unknown }[],
  log: (direction: "in" | "out", body: string, extra: Record<string, unknown>) => Promise<unknown>,
): Promise<CallReply | null> {
  const tree = phoneTree(heard, want);
  if (!tree) return null;
  const count = (k: string) => earlier.filter((m) => (m.data as Record<string, unknown> | null)?.[k]).length;
  if (tree.kind === "menu") {
    const pressed = count("pressed");
    if (pressed >= MAX_PRESSES) return { reply: "", hangUp: true };
    const digit = pressed >= 2 ? "0" : tree.digit;
    await log("in", heard, { menu: true });
    await log("out", `(pressed ${digit}${digit === tree.digit ? `, ${tree.option}` : ", for a person"})`, { pressed: digit });
    return { reply: "", hangUp: false, digits: digit };
  }
  if (count("hold") >= MAX_HOLDS) return { reply: "", hangUp: true };
  await log("in", heard, { hold: true });
  return { reply: "", hangUp: false, hold: true };
}
