import { resolveUrls } from './urls';

/**
 * API and web app URLs for this build. Set WXT_PUBLIC_API_URL and
 * WXT_PUBLIC_FRONTEND_URL in `extension/.env` (see `.env.example`); the same
 * values drive the manifest host permissions in wxt.config.ts. Each property is
 * read explicitly so Vite can inline it at build time.
 */
export const { apiUrl, frontendUrl } = resolveUrls({
  WXT_PUBLIC_API_URL: import.meta.env.WXT_PUBLIC_API_URL,
  WXT_PUBLIC_FRONTEND_URL: import.meta.env.WXT_PUBLIC_FRONTEND_URL,
});
