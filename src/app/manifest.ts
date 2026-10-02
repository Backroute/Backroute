import type { MetadataRoute } from "next";

/** Installable on a phone's home screen, which iPhones need before they allow push notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Backroute",
    short_name: "Backroute",
    description: "Your AI dispatcher",
    start_url: "/carrier",
    display: "standalone",
    id: "/",
    scope: "/",
    orientation: "portrait",
    // The launch screen on Android: this color with the icon in the middle (iPhones use public/splash).
    background_color: "#0a0a08",
    // The icon number (Needs you for owners) is set by the app itself (lib/app-badge).
    theme_color: "#0a0a08",
    categories: ["business", "productivity", "navigation"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops icons to its own shape: this one keeps the mark inside the safe circle.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // What the install sheet shows (Chrome's richer install dialog, app stores that take web apps).
    screenshots: [
      { src: "/screenshots/driver-trip.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "The driver's trip: map first, next step below" },
      { src: "/screenshots/owner-today.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "The owner's day: what needs you, and the fleet on a map" },
      { src: "/screenshots/owner-money.jpg", sizes: "780x1688", type: "image/jpeg", form_factor: "narrow", label: "Money: the week's profit and what moved it" },
      { src: "/screenshots/owner-desktop.jpg", sizes: "1440x900", type: "image/jpeg", form_factor: "wide", label: "The owner's dashboard on a computer" },
    ],
    // Long-press the app icon: straight to what's most used.
    shortcuts: [
      { name: "Needs you", short_name: "Needs you", url: "/carrier#needs-you", description: "What's waiting for your OK" },
      { name: "Ask the AI", short_name: "Ask AI", url: "/carrier/messages", description: "Ask or tell your AI dispatcher" },
      { name: "My next stop", short_name: "Next stop", url: "/driver", description: "Drivers: the trip you're on" },
      { name: "Dispatch messages", short_name: "Messages", url: "/driver/messages", description: "Drivers: talk to dispatch" },
    ],
  };
}
