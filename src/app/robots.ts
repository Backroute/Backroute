import type { MetadataRoute } from "next";

/** Search engines may read the website; the apps, the support console and the API are for signed-in people only. */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.PUBLIC_BASE_URL ?? "https://backroute.pro").replace(/\/$/, "");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/carrier", "/driver", "/ops", "/today"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
