import type { Metadata } from "next";

export const metadata: Metadata = { title: "Load tracking", robots: { index: false, follow: false } };

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[var(--surface,#f7f7f8)]">{children}</div>;
}
