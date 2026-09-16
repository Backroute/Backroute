"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, type LucideIcon } from "lucide-react";
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
  href: string;
}

export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

export function CommandPalette({ groups }: { groups: CommandGroup[] }) {
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
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => it.label.toLowerCase().includes(q) || it.sublabel?.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  const flatItems = useMemo(() => filteredGroups.flatMap((g) => g.items), [filteredGroups]);

  function select(item: CommandItem) {
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line-strong bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
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
            placeholder="Search or jump to..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-400">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
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
                      <span className={cn("shrink-0 truncate text-xs", flatIdx === activeIndex ? "text-white/50" : "text-ink-400")}>
                        {item.sublabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
