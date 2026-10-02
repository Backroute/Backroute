import { ViewTransition } from "react";

/**
 * Pages slide the way you moved: to a tab on the right, or deeper into a load, the new page comes in from the right;
 * back, it comes from the left. Anything else (browser back, a refresh) just swaps.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
