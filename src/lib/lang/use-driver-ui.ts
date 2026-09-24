"use client";

import { usePrimaryDriver } from "../selectors";
import { LANG_INFO } from "./pack";
import { UI } from "./ui";

/** The signed-in driver's language and the app's words in it. */
export function useDriverUi() {
  const driver = usePrimaryDriver();
  const lang = driver.prefs?.language ?? "en";
  return { t: UI[lang], lang, info: LANG_INFO[lang] };
}
