import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SimulationProvider } from "@/components/simulation-provider";
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
  title: "Backroute — Autonomous freight dispatch",
  description:
    "Backroute sources, negotiates, books, tracks, documents, and chains every load, end to end, so your trucks never run empty.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-ink-950">
        <SimulationProvider>{children}</SimulationProvider>
      </body>
    </html>
  );
}
