import type { Lang } from "../types";
import type { CallPack } from "./pack";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { hi } from "./hi";
import { pa } from "./pa";
import { ru } from "./ru";
import { uk } from "./uk";

export { LANGS, LANG_INFO } from "./pack";
export type { CallPack, LangInfo, PrefKey, QuickPhrase } from "./pack";

const PACKS: Record<Lang, CallPack> = { en, es, pa, hi, ru, uk, fr };

/** What the AI says, in a driver's or owner's language. */
export function pack(lang: Lang | undefined): CallPack {
  return PACKS[lang ?? "en"] ?? en;
}
