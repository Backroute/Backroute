import Link from "next/link";
import { Logo } from "@/components/shared/logo";

/** A plain page for something this site doesn't have: the demo on the real site, or a real site not set up yet. */
export function NotAvailable({ title, body, link }: { title: string; body: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-50 px-6 text-center">
      <Logo />
      <h1 className="font-display text-2xl text-ink-950">{title}</h1>
      <p className="max-w-sm text-sm text-ink-600">{body}</p>
      {link && (
        <Link href={link.href} className="text-sm font-medium text-ink-950 underline">
          {link.label}
        </Link>
      )}
    </div>
  );
}
