/** Where the theme choice is kept on this device (lib/theme). */
export const THEME_KEY = "backroute.theme";

/** Runs in <head> before anything paints (app/layout.tsx). Keep it tiny and dependency-free. */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("${THEME_KEY}")||"system";var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;
