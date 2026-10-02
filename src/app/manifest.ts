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
    // The icon number (Needs you for owners) is set by the app itself (lib/app-badge).
    theme_color: "#0a0a0a",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
    // Long-press the app icon: straight to what's most used.
    shortcuts: [
      { name: "Needs you", short_name: "Needs you", url: "/carrier#needs-you", description: "What's waiting for your OK" },
      { name: "Ask the AI", short_name: "Ask AI", url: "/carrier/messages", description: "Ask or tell your AI dispatcher" },
      { name: "My next stop", short_name: "Next stop", url: "/driver", description: "Drivers: the trip you're on" },
      { name: "Dispatch messages", short_name: "Messages", url: "/driver/messages", description: "Drivers: talk to dispatch" },
    ],
  };
}
