"use client";

import { usePrimaryDriver } from "../selectors";
import { useStore } from "../store";
import { LANG_INFO } from "./pack";
import { UI } from "./ui";

/**
 * The signed-in driver's two languages, which are often different: the app's screens (`lang`, `t`) and the
 * language they talk and get texts in (`talk`, `tt`) — plenty of drivers read an app in English but want their
 * calls in Punjabi or Spanish.
 */
export function useDriverUi() {
  const driver = usePrimaryDriver();
  const lang = driver.prefs?.appLanguage ?? "en";
  const talk = driver.prefs?.language ?? "en";
  // Owner-operator: this driver owns the truck, so the app is the whole business.
  const solo = useStore((s) => s.settings.ownerOperator);
  return { t: UI[lang], lang, info: LANG_INFO[lang], talk, tt: UI[talk], talkInfo: LANG_INFO[talk], solo };
}
