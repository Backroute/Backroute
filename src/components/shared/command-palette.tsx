"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "backroute:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon?: LucideIcon;
  /** Go somewhere… */
  href?: string;
  /** …or do something right here. */
  run?: () => void;
  /** Other words people use for it ("dark", "night" for dark mode). */
  keywords?: string;
}

export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

/** Words that read as an order or a question for the AI rather than something to find. */
const ORDER = /^(book|send|tell|ask|call|text|email|find|get|move|cancel|counter|accept|decline|pass|pay|invoice|remind|plan|put|give|set|change|what|how|why|when|where|who|which|is|are|did|does|do|can|should|show me)\b/i;

const ASK_ID = "__ask_ai";

/**
 * Search, jump and give orders from one box (⌘K, or the search field up top). Typing finds pages, loads, trucks and
 * drivers, and runs quick actions (pause the AI, dark mode). Anything else, like "book Marcus home Friday" or "what
 * did we make on TX to TN?", goes to the AI dispatcher as a message, which answers or does it (asking first when it
 * would spend or commit money).
 */
export function CommandPalette({ groups, onAsk }: { groups: CommandGroup[]; onAsk?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (o) return false;
          setQuery("");
          setActiveIndex(0);
          return true;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      setQuery("");
      setActiveIndex(0);
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    const words = q.split(/\s+/);
    const hit = (it: CommandItem) => {
      const hay = `${it.label} ${it.sublabel ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    return groups.map((g) => ({ ...g, items: g.items.filter(hit) })).filter((g) => g.items.length > 0);
  }, [groups, query]);

  const text = query.trim();
  const found = filteredGroups.flatMap((g) => g.items);
  // An order or question (or nothing found) puts "Ask the AI" first; otherwise it waits at the bottom.
  const askFirst = !!onAsk && !!text && (ORDER.test(text) || found.length === 0);
  const ask: CommandItem | null = onAsk && text ? { id: ASK_ID, label: text, icon: Sparkles, run: () => onAsk(text) } : null;
  const flatItems = ask ? (askFirst ? [ask, ...found] : [...found, ask]) : found;

  function select(item: CommandItem) {
    setOpen(false);
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  }

  if (!open) return null;

  const askRow = (item: CommandItem) => {
    const idx = flatItems.indexOf(item);
    return (
      <div className="mb-1">
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Ask the AI dispatcher</p>
        <button
          onMouseEnter={() => setActiveIndex(idx)}
          onClick={() => select(item)}
          className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm", idx === activeIndex ? "bg-ink-950 text-white" : "text-ink-800 hover:bg-ink-50")}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">&ldquo;{item.label}&rdquo;</span>
          <CornerDownLeft className={cn("h-3.5 w-3.5 shrink-0", idx === activeIndex ? "text-white/60" : "text-ink-300")} />
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search, jump to, or tell the AI"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line-strong bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            aria-label="Search or tell the AI"
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && flatItems[activeIndex]) {
                select(flatItems[activeIndex]);
              }
            }}
            placeholder={onAsk ? "Search, or tell the AI what to do…" : "Search or jump to..."}
            className="flex-1 bg-transparent text-sm text-ink-950 outline-none placeholder:text-ink-400"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-400">esc</kbd>
        </div>

        <div className="max-h-[22rem] overflow-y-auto p-2">
          {!text && onAsk && (
            <p className="px-3 pb-2 pt-1 text-xs text-ink-500">
              Try &ldquo;pause the AI&rdquo;, &ldquo;dark mode&rdquo;, a truck or load number, or an order like &ldquo;book Marcus home by Friday&rdquo;.
            </p>
          )}
          {ask && askFirst && askRow(ask)}
          {flatItems.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-400">No results.</p>}
          {filteredGroups.map((g) => (
            <div key={g.heading} className="mb-1">
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{g.heading}</p>
              {g.items.map((item) => {
                const flatIdx = flatItems.indexOf(item);
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setActiveIndex(flatIdx)}
                    onClick={() => select(item)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                      flatIdx === activeIndex ? "bg-ink-950 text-white" : "text-ink-800 hover:bg-ink-50",
                    )}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className={cn("shrink-0 truncate text-xs", flatIdx === activeIndex ? "text-white/50" : "text-ink-400")}>{item.sublabel}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {ask && !askFirst && askRow(ask)}
        </div>
      </div>
    </div>
  );
}
