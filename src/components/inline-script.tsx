/**
 * A script that runs while the page is first parsed (before paint). On the client it renders as plain text, so React
 * doesn't warn about a script it won't run; suppressHydrationWarning covers that one difference.
 * (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md)
 */
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
