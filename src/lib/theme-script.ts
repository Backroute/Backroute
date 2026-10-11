/** Where the theme choice is kept on this device (lib/theme). */
export const THEME_KEY = "backroute.theme";

/** Bigger text and higher contrast, per device (the driver's Profile → App). */
export const TEXT_KEY = "backroute.text";
export const CONTRAST_KEY = "backroute.contrast";

/** Runs in <head> before anything paints (app/layout.tsx). Keep it tiny and dependency-free. */
export const THEME_SCRIPT = `(function(){try{var r=document.documentElement;var c=localStorage.getItem("${THEME_KEY}")||"system";var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);r.setAttribute("data-theme",d?"dark":"light");var t=localStorage.getItem("${TEXT_KEY}");if(t==="large"||t==="xl")r.setAttribute("data-text",t);if(localStorage.getItem("${CONTRAST_KEY}")==="high")r.setAttribute("data-contrast","high")}catch(e){}})()`;
