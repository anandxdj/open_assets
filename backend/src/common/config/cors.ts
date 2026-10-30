import type { CorsOptions } from 'cors';
import type { AppConfig } from './env';
import { ApiError } from '../utils/ApiError';

// Only used outside production: any localhost port and any unpacked extension.
const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EXTENSION_DEV_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/**
 * Browsers send `Origin` on cross-site requests. Requests without one (curl,
 * server-to-server calls, same-origin navigations) are not subject to CORS and
 * pass through. Everything else must be the web app, an origin listed in
 * CORS_ORIGINS or EXTENSION_ORIGINS, or (outside production) a local dev origin.
 */
export function isOriginAllowed(origin: string, config: Pick<AppConfig, 'cors'>): boolean {
  if (config.cors.origins.includes(origin)) return true;
  if (config.cors.allowLocalDevOrigins) {
    return LOCAL_DEV_ORIGIN.test(origin) || EXTENSION_DEV_ORIGIN.test(origin);
  }
  return false;
}

export function createCorsOptions(config: Pick<AppConfig, 'cors'>): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (!origin || isOriginAllowed(origin, config)) {
        callback(null, true);
        return;
      }
      // Reaches the error handler as a 403 instead of a 500.
      callback(ApiError.forbidden('Origin not allowed'));
    },
    credentials: true,
  };
}
