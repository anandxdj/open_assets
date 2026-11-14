/**
 * A one-bit memory of "this browser was signed in last time".
 *
 * The session is restored in the browser (a refresh cookie on the API host), so
 * server-rendered public pages cannot know who is looking. Without a hint the
 * marketing header paints the signed-out buttons (or a gap) first and then jumps
 * when the session comes back. The hint lets the header show the right variant
 * on the first paint: `SESSION_HINT_SCRIPT` runs in <head> before the body is
 * painted and sets `data-session="1"` on <html>, and CSS (globals.css) shows
 * the matching variant of any `[data-auth]` element while the session is still
 * loading. It is a guess for layout only: the real state always wins once
 * AuthContext has restored the session, and nothing is authorised by it.
 */

export const SESSION_HINT_KEY = "oa-session";

/** Inline script for <head>: copies the stored hint onto <html data-session>. */
export const SESSION_HINT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(SESSION_HINT_KEY)})==="1")document.documentElement.setAttribute("data-session","1")}catch(e){}`;

/** Remembers (or forgets) that a session exists, for the next page load and for this one. */
export function setSessionHint(signedIn: boolean): void {
  if (typeof document === "undefined") return;
  if (signedIn) document.documentElement.setAttribute("data-session", "1");
  else document.documentElement.removeAttribute("data-session");
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT_KEY, "1");
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage blocked (private mode): the header just falls back to the signed-out variant.
  }
}
