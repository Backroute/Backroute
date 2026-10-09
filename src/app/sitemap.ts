import type { MetadataRoute } from "next";
import { demoAllowed } from "@/lib/cloud/demo";

/** The public pages, for search engines. The apps behind sign-in aren't listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://backroute.pro").replace(/\/$/, "");
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/signup`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/login`, changeFrequency: "yearly", priority: 0.3 },
    ...(demoAllowed ? [{ url: `${base}/demo`, changeFrequency: "monthly" as const, priority: 0.6 }] : []),
  ];
}
