import { Mail, MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/types";

const CHANNEL_META: Record<Channel, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: "Email" },
  sms: { icon: MessageSquare, label: "SMS" },
  voice: { icon: Phone, label: "Voice" },
};

export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = CHANNEL_META[channel].icon;
  return <Icon className={cn("h-3.5 w-3.5", className)} strokeWidth={2} />;
}

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const meta = CHANNEL_META[channel];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700", className)}>
      <Icon className="h-3 w-3" strokeWidth={2} />
      {meta.label}
    </span>
  );
}
