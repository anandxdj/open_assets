# OpenAssets extension

Chrome extension (Manifest V3, built with [WXT](https://wxt.dev), React and TypeScript).
It does two things for a signed-in OpenAssets account:

- **Extract**: right-click an image, press Alt+Shift+E, or use the Extract tab to send an
  image from any page to OpenAssets and open it in the editor.
- **Generate**: queue prompts in the side panel and run them in a ChatGPT tab, saving the
  results to the Library.

## Prerequisites

Node 20+ and pnpm. Install once with `pnpm install`.

## Configure the URLs

The extension talks to the OpenAssets API and signs in through the web app. Both URLs are
set at build time:

```bash
cp .env.example .env     # then edit
```

| Variable | Default | Used for |
|---|---|---|
| `WXT_PUBLIC_API_URL` | `https://openasset-backend.anands.dev` | API calls; its origin becomes a manifest host permission |
| `WXT_PUBLIC_FRONTEND_URL` | `https://openassets.anands.dev` | Sign-in page (`/extension/connect`), editor links |
| `EXTENSION_PUBLIC_KEY` | unset | Optional manifest `key`, to keep one extension ID across store and unpacked builds |

Rules: `https` only (`http://localhost` and `http://127.0.0.1` are allowed for local work),
and an invalid value fails the build. A value in the shell beats `.env`. Production builds
add no localhost permission unless you point a URL at localhost. Rebuild after changing
anything. For the local dev stack use `http://localhost:4104` and `http://localhost:3104`.

## Load it unpacked

```bash
pnpm build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and
select `.output/chrome-mv3`. Or run `pnpm dev`, which opens a Chrome profile with the
extension loaded and reloads it on change.

Pin the extension, open it, and use **Connect account** to sign in through the web app.

## Backend CORS (production)

Requests from the extension carry an `Origin` of `chrome-extension://<extension-id>`, and the
backend rejects origins it does not know. Outside production it accepts any extension
origin; in production add yours to the backend's `EXTENSION_ORIGINS` (comma-separated):

```bash
EXTENSION_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

An unpacked build gets a random ID unless `EXTENSION_PUBLIC_KEY` is set. The Chrome Web Store
assigns the permanent ID when you create the item; copy it from the dashboard.

## Build for the Chrome Web Store

1. Raise `version` in `package.json` (the manifest version comes from it; the store rejects
   a repeated version).
2. Build against production URLs: leave `.env` empty or set the real ones. Do not set
   `EXTENSION_PUBLIC_KEY` for the upload.
3. `pnpm zip` writes `.output/openassets-extension-<version>-chrome.zip`.
4. Upload it in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole),
   then fill in the listing.

Checks before upload: `pnpm typecheck`, `pnpm test`, and open `.output/chrome-mv3/manifest.json` to
confirm `host_permissions` lists your API origin and `https://chatgpt.com/*` only.

### Listing notes

- **Single purpose:** send images from web pages and ChatGPT generations to the user's
  OpenAssets account and manage them there.
- **Privacy policy URL:** `<WXT_PUBLIC_FRONTEND_URL>/privacy`.
- **Data:** an image is uploaded only when the user picks it. Prompts, reference images and
  the library stay in the browser's extension storage; the access token is kept in session
  storage only. No analytics or remote code.
- **Icons:** `public/icons/icon{16,32,48,128}.png`, the OA monogram on ink. The 128 px file keeps
  the 16 px transparent margin the store asks for. Screenshots (1280x800) and the promo
  tiles are not in the repo.

### Permission justifications

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's URL and inject the image picker after the user presses the shortcut or **Select an image on this page** |
| `scripting` | Inject that picker into the page the user chose |
| `contextMenus` | The "Extract with OpenAssets" entry on images |
| `identity` | `launchWebAuthFlow` sign-in through the web app (PKCE) |
| `storage` | Account, queue, library and tokens |
| `downloads` | Save generated images to disk |
| `alarms` | One-minute tick that resumes the generation queue after the service worker sleeps, and clears the error badge |
| `sidePanel` | The workspace UI |
| Host `<api origin>/*` | API calls without CORS preflight failures |
| Host `https://chatgpt.com/*` | The content script that drives the Generate queue, and finding the ChatGPT tab |
| Optional `http(s)://*/*` | Not granted at install. Chrome asks per site, the first time the user picks an image on that site |

The web app origin has no host permission: it is only opened in a tab and in the sign-in flow.
Failures from the context menu and the shortcut show as a `!` badge and tooltip on the toolbar
button, so no `notifications` permission is needed.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Dev build with reload |
| `pnpm build` | Production build to `.output/chrome-mv3` |
| `pnpm zip` | Build and zip for the store |
| `pnpm typecheck` | `wxt prepare` and `tsc --noEmit` |
| `pnpm test` | Vitest (URL and permission logic) |
