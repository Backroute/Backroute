import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SimulationProvider } from "@/components/simulation-provider";
import { MotionRoot } from "@/components/motion-root";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Backroute: Autonomous freight dispatch",
  description:
    "Backroute sources, negotiates, books, tracks, documents, and chains every load, end to end, so your trucks never run empty.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Light or dark before the first paint (lib/theme): no white flash on a dark-mode phone. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-ink-950">
        <MotionRoot>
          <SimulationProvider>{children}</SimulationProvider>
        </MotionRoot>
      </body>
    </html>
  );
}
