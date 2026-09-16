"use client";

import { useNow } from "@/lib/hooks";
import { formatTime, timeAgo } from "@/lib/utils";

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const now = useNow(1000);
  return <span className={className}>{now === null ? formatTime(iso) : timeAgo(iso, now)}</span>;
}
