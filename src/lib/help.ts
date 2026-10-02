/** The "?" next to settings (components/ui/help): what each one does, in two plain lines, with an example. */
export const HELP = {
  minRpm: {
    title: "Lowest rate per loaded mile",
    what: "The AI never asks for, counters at, or agrees to less than this per loaded mile. A broker who won't come up to it gets a polite pass.",
    example: "At $2.00, a 500-mile load has to pay at least $1,000 before the AI will take it.",
  },
  deadhead: {
    title: "Empty miles to a pickup",
    what: "How far a truck may drive empty to get to the next pickup. Loads further away are skipped, however well they pay.",
    example: "At 150 miles, a truck empty in Dallas won't be sent to a pickup in Houston (240 miles).",
  },
  autopilot: {
    title: "How much the AI does without asking",
    what: "Ask me first: every email to a broker waits for you. Within my rules: it books and bills on its own inside your numbers. Full autopilot: it also sends the replies it writes.",
    example: "On Within my rules, a $2.40/mile load over your $2.00 floor gets booked; a $1.80 one comes to you.",
  },
  undo: {
    title: "Time to stop the AI's emails",
    what: "When the AI books, counters or accepts on its own, the email waits this long first. Tap Undo on Home and it never goes.",
    example: "Undo 90 seconds: you have a minute and a half to stop an email before the broker gets it.",
  },
  homeTime: {
    title: "When each driver gets home",
    what: "The AI checks every load against this before booking it, and plans the next loads to bring the driver home on time.",
    example: "\"Home by Friday\" means no Wednesday load that would leave the truck 900 miles away on Friday.",
  },
  alerts: {
    title: "How we reach you",
    what: "Only three things reach you: something that needs your decision, money moving, and safety. Everything else happens quietly and shows in the AI log.",
    example: "A detention claim the AI sent is logged; a broker paying $300 short texts you.",
  },
  dailyText: {
    title: "End-of-day text",
    what: "One text at 6 PM: what delivered, what it made, and anything that needs you tomorrow.",
    example: "\"3 delivered, $4,210 in. 1 thing for tomorrow: approve T-104's repair quote.\"",
  },
  weeklyReview: {
    title: "Your week, Monday morning",
    what: "A one-minute look at last week: what the trucks made, empty miles, best and worst broker, and one thing worth changing.",
    example: "\"Empty miles were 24%. Raising empty-mile limit to 200 would have added two loads.\"",
  },
  morningBriefs: {
    title: "Drivers' morning text",
    what: "Each driver gets their stops, appointment times, dock tips and weather before they roll. Drivers can turn theirs off.",
    example: "\"Pickup 8:00 AM at Sysco Dallas, dock 14, they check in at the side gate. Rain after noon.\"",
  },
  notifySms: {
    title: "Text me when something needs me",
    what: "A text the moment something waits for your OK, so you don't have to keep the app open.",
    example: "\"Broker wants $1,700 on TQL-5502 (you're at $1,900). Reply or open the app.\"",
  },
  notifyEmail: {
    title: "Email me every alert",
    what: "A copy of each alert by email, for your records or a partner who handles the office.",
    example: "Each needs-you, money and safety alert also lands in your inbox.",
  },
} as const;

export type HelpKey = keyof typeof HELP;
