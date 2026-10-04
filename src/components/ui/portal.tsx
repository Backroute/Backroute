"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

/**
 * Renders straight into <body>, so a layer that covers the screen (driving mode, a call, a sheet) is never trapped
 * under a page's own raised card or sticky bars. Nothing on the server pass: these only open after a tap.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return mounted ? createPortal(children, document.body) : null;
}
