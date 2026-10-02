/**
 * Which way a page slides when you tap a tab: one to the right of where you are comes in from the right, one to the
 * left from the left (the way the tab bar itself is laid out).
 */
export function slideTypes(order: string[], current: string | undefined, target: string): string[] | undefined {
  const from = current ? order.indexOf(current) : -1;
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return undefined;
  return [to > from ? "nav-forward" : "nav-back"];
}

export const FORWARD = ["nav-forward"];
export const BACK = ["nav-back"];
