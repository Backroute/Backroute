"use client";

import { useNow } from "@/lib/hooks";
import { formatTime, timeAgo } from "@/lib/utils";

/** The demo world is seeded when each process starts, so the server's clock times are older than the browser's;
 *  the first client tick replaces the server text anyway, so that one-render mismatch is expected. */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const now = useNow();
  return (
    <span className={className} suppressHydrationWarning>
      {now === null ? formatTime(iso) : timeAgo(iso, now)}
    </span>
  );
}
