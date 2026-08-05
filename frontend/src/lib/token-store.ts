let _token: string | null = null;

export const tokenStore = {
  get: () => _token,
  set: (token: string | null) => {
    _token = token;

    // Bridge the token to the browser extension. The extension's content script
    // reads localStorage['accessToken'] and listens for the 'openassets:token'
    // event to sync the JWT into chrome.storage. In production the extension
    // mints its own token from the refresh cookie, so this is only the local-dev
    // fallback (where the SameSite=Lax cookie isn't sent cross-origin). Keeping
    // the access token (short-lived) here is an accepted trade-off; the refresh
    // token stays httpOnly.
    if (typeof window !== "undefined") {
      try {
        if (token) localStorage.setItem("accessToken", token);
        else localStorage.removeItem("accessToken");
        window.dispatchEvent(new CustomEvent("openassets:token", { detail: token }));
      } catch {
        // localStorage may be unavailable (private mode / blocked) — ignore.
      }
    }
  },
};
