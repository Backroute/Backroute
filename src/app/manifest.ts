import type { MetadataRoute } from "next";

/** Installable on a phone's home screen, which iPhones need before they allow push notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Backroute",
    short_name: "Backroute",
    description: "Your AI dispatcher",
    start_url: "/carrier",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
