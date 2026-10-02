import { cn } from "@/lib/utils";

/** A grey stand-in for something still loading, with a soft shimmer (none for people who turned motion off). */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton block rounded-xl", className)} />;
}

/** The shape of a card: a title line, two lines of text and a button. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("rounded-2xl border border-line bg-white p-4", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-4 h-7 w-28 rounded-full" />
    </div>
  );
}

/**
 * The app's outline while the fleet loads, so the page never sits blank and nothing jumps when it arrives: the owner
 * sees the sidebar, the header and the cards; a driver sees their phone screen.
 */
export function AppSkeleton({ area }: { area: "carrier" | "driver" | "signup" }) {
  const status = (
    <p role="status" className="sr-only">
      Loading your fleet
    </p>
  );
  if (area === "driver")
    return (
      <div className="flex min-h-screen justify-center bg-ink-100">
        {status}
        <div className="flex w-full max-w-md flex-col gap-4 bg-white px-5 pt-5 sm:my-6 sm:rounded-[2.5rem] sm:border sm:border-line">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-56 w-full rounded-3xl" />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  return (
    <div className="flex min-h-screen w-full bg-background">
      {status}
      <aside className="hidden w-64 shrink-0 flex-col gap-3 border-r border-line px-5 py-6 lg:flex">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-6 h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </aside>
      <main className="min-w-0 flex-1 bg-ink-50/40">
        <div className="border-b border-line px-4 py-3 sm:px-8">
          <Skeleton className="h-8 w-full max-w-xs rounded-full" />
        </div>
        <div className="border-b border-line px-4 py-6 sm:px-8">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="flex flex-col gap-4 px-4 py-6 sm:px-8">
          <Skeleton className="h-44 w-full rounded-3xl" />
          <div className="grid gap-3 md:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </main>
    </div>
  );
}
