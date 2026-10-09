import { ImageResponse } from "next/og";

/** The card a shared link shows (texts, WhatsApp, social): the headline over the route, black like the site's top. */

export const alt = "Backroute: your next load is already booked.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#000", color: "#fff", padding: 72, position: "relative" }}>
        <svg width="1200" height="630" viewBox="-90 40 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M700 420 C 780 330, 860 300, 930 290 S 1080 340, 1060 440 S 880 520, 820 490 S 730 460, 700 420" fill="none" stroke="#276EF1" strokeWidth="6" strokeDasharray="18 10" />
          <circle cx="700" cy="420" r="11" fill="#fff" />
          <circle cx="930" cy="290" r="11" fill="#fff" />
          <circle cx="1060" cy="440" r="11" fill="#fff" />
          <circle cx="820" cy="490" r="11" fill="#fff" />
          <circle cx="930" cy="290" r="24" fill="none" stroke="#06C167" strokeWidth="4" />
        </svg>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Backroute</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1, letterSpacing: -3, maxWidth: 640 }}>Your next load is already booked.</div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: "rgba(255,255,255,0.7)" }}>The AI dispatcher for owner-operators and small fleets.</div>
        </div>
      </div>
    ),
    size,
  );
}
