/**
 * Startup configuration check.
 *
 * `checkEnv` reads the environment once and returns a typed config plus every
 * problem it found, so a bad deploy fails at boot with one clear list instead of
 * a stack trace from whichever module touches the missing value first. Errors
 * stop startup. Warnings describe features that will run degraded.
 *
 * It is pure (takes the environment as an argument) so tests can drive it.
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type SameSite = 'lax' | 'strict' | 'none';
export type StorageProvider = 'cloudinary' | 'imagekit';

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  mongoUri: string;
  mongoDbName: string | undefined;
  redisUrl: string;
  frontendUrl: string;
  pyBackendUrl: string;
  storageProvider: StorageProvider;
  cors: {
    /** Exact origins allowed to call the API with credentials (frontend, extra origins, extension ids). */
    origins: string[];
    /** Outside production, any localhost port and any unpacked extension may call the API. */
    allowLocalDevOrigins: boolean;
  };
  cookie: {
    secure: boolean;
    sameSite: SameSite;
    domain: string | undefined;
  };
  shutdownTimeoutMs: number;
}

export interface EnvReport {
  config: AppConfig;
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const DEFAULT_PORT = 4000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;
const DEV_FRONTEND_URL = 'http://localhost:3000';
const DEV_PY_BACKEND_URL = 'http://localhost:8000';
const DEV_REDIS_URL = 'redis://127.0.0.1:6379';

/** Values copied from .env.example that must never reach production. */
const PLACEHOLDER = /^(change[-_ ]?me|changeme|secret|password|example|your[-_ ])/i;
const MIN_SECRET_LENGTH = 32;

function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** An origin is scheme://host[:port] with no path, query or trailing slash. */
function isOrigin(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/\s?#]+$/i.test(value);
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const lowered = value.toLowerCase();
  if (lowered === 'true' || lowered === '1') return true;
  if (lowered === 'false' || lowered === '0') return false;
  return null;
}

export function checkEnv(env: Env = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawNodeEnv = read(env, 'NODE_ENV');
  const nodeEnv: NodeEnv =
    rawNodeEnv === 'production' || rawNodeEnv === 'test' ? rawNodeEnv : 'development';
  const isProduction = nodeEnv === 'production';
  // Required in production; only a warning in development, where the feature is simply off.
  const need = (message: string) => (isProduction ? errors.push(message) : warnings.push(message));
  if (rawNodeEnv && !['production', 'development', 'test'].includes(rawNodeEnv)) {
    warnings.push(`NODE_ENV="${rawNodeEnv}" is not production, development or test: treating it as development`);
  }

  // ── Server ──────────────────────────────────────────────────────────────
  let port = DEFAULT_PORT;
  const rawPort = read(env, 'PORT');
  if (rawPort !== undefined) {
    const parsed = Number(rawPort);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) port = parsed;
    else errors.push(`PORT must be an integer between 1 and 65535 (got "${rawPort}")`);
  }

  let shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const rawShutdown = read(env, 'SHUTDOWN_TIMEOUT_MS');
  if (rawShutdown !== undefined) {
    const parsed = Number(rawShutdown);
    if (Number.isInteger(parsed) && parsed >= 1000) shutdownTimeoutMs = parsed;
    else errors.push(`SHUTDOWN_TIMEOUT_MS must be an integer of at least 1000 milliseconds (got "${rawShutdown}")`);
  }

  // ── Data stores ─────────────────────────────────────────────────────────
  const mongoUri = read(env, 'MONGO_URI') ?? '';
  if (!mongoUri) {
    errors.push('MONGO_URI is required (a mongodb:// or mongodb+srv:// connection string)');
  } else if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    errors.push('MONGO_URI must start with mongodb:// or mongodb+srv://');
  }
  const mongoDbName = read(env, 'MONGO_DB_NAME');
  if (isProduction && mongoUri && !mongoDbName && !/^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(mongoUri)) {
    warnings.push('MONGO_DB_NAME is not set and MONGO_URI names no database: MongoDB will use its default "test" database');
  }

  let redisUrl = read(env, 'REDIS_URL') ?? '';
  if (!redisUrl) {
    if (isProduction) errors.push('REDIS_URL is required in production (a redis:// or rediss:// URL)');
    redisUrl = DEV_REDIS_URL;
  } else if (!/^rediss?:\/\//.test(redisUrl)) {
    errors.push('REDIS_URL must start with redis:// or rediss://');
  }

  // ── Neighbouring services ──────────────────────────────────────────────
  let frontendUrl = read(env, 'FRONTEND_URL') ?? '';
  if (!frontendUrl) {
    if (isProduction) errors.push('FRONTEND_URL is required in production (the public URL of the web app, used for CORS and email links)');
    frontendUrl = DEV_FRONTEND_URL;
  } else if (!isHttpUrl(frontendUrl)) {
    errors.push('FRONTEND_URL must be an http(s) URL such as https://app.example.com');
  } else if (frontendUrl.endsWith('/')) {
    warnings.push('FRONTEND_URL ends with "/": links and redirects built from it will contain a double slash. Remove the trailing slash');
  } else if (isProduction && frontendUrl.startsWith('http://')) {
    warnings.push('FRONTEND_URL is http:// in production: browsers will not send Secure cookies over it');
  }

  let pyBackendUrl = read(env, 'PY_BACKEND_URL') ?? '';
  if (!pyBackendUrl) {
    if (isProduction) errors.push('PY_BACKEND_URL is required in production (the internal URL of the Python AI service)');
    pyBackendUrl = DEV_PY_BACKEND_URL;
  } else if (!isHttpUrl(pyBackendUrl)) {
    errors.push('PY_BACKEND_URL must be an http(s) URL such as http://py_backend:8000');
  }

  // ── Secrets ─────────────────────────────────────────────────────────────
  const accessSecret = read(env, 'JWT_ACCESS_SECRET') ?? read(env, 'JWT_SECRET');
  const refreshSecret = read(env, 'JWT_REFRESH_SECRET');
  if (isProduction) {
    for (const [name, value] of [
      ['JWT_ACCESS_SECRET', accessSecret],
      ['JWT_REFRESH_SECRET', refreshSecret],
    ] as const) {
      if (!value) errors.push(`${name} is required in production`);
      else if (PLACEHOLDER.test(value)) errors.push(`${name} is still the placeholder from .env.example: generate a real secret`);
      else if (value.length < MIN_SECRET_LENGTH) errors.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production`);
    }
    if (accessSecret && refreshSecret && accessSecret === refreshSecret) {
      errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values');
    }
  }

  const serviceToken = read(env, 'INTERNAL_SERVICE_TOKEN');
  if (isProduction && (!serviceToken || PLACEHOLDER.test(serviceToken))) {
    warnings.push('INTERNAL_SERVICE_TOKEN is unset or still a placeholder: Studio credit refunds will be rejected');
  }
  const internalApiToken = read(env, 'INTERNAL_API_TOKEN');
  if (isProduction && (!internalApiToken || PLACEHOLDER.test(internalApiToken))) {
    warnings.push('INTERNAL_API_TOKEN is unset or still a placeholder: the Python AI service will accept unauthenticated calls');
  }

  // ── Object storage ──────────────────────────────────────────────────────
  const rawStorage = read(env, 'STORAGE_PROVIDER') ?? 'cloudinary';
  let storageProvider: StorageProvider = 'cloudinary';
  if (rawStorage === 'cloudinary' || rawStorage === 'imagekit') storageProvider = rawStorage;
  else errors.push(`STORAGE_PROVIDER must be "cloudinary" or "imagekit" (got "${rawStorage}")`);

  const storageKeys =
    storageProvider === 'imagekit'
      ? ['IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_URL_ENDPOINT']
      : ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missingStorage = storageKeys.filter((key) => !read(env, key));
  if (missingStorage.length) {
    need(`${missingStorage.join(', ')} ${missingStorage.length > 1 ? 'are' : 'is'} required for STORAGE_PROVIDER=${storageProvider}: uploads will fail until set`);
  }

  // ── Email and Google sign-in ────────────────────────────────────────────
  if (read(env, 'RESEND_API_KEY')) {
    if (!read(env, 'RESEND_FROM_EMAIL')) need('RESEND_FROM_EMAIL is required when RESEND_API_KEY is set (a sender address on a verified Resend domain)');
  } else if (isProduction) {
    warnings.push('RESEND_API_KEY is not set: verification and password-reset emails are only logged, never sent');
  }

  const googleId = read(env, 'GOOGLE_CLIENT_ID');
  const googleSecret = read(env, 'GOOGLE_CLIENT_SECRET');
  const googleCallback = read(env, 'GOOGLE_CALLBACK_URL') ?? read(env, 'GOOGLE_REDIRECT_URI');
  // The callback URL alone (as in .env.example) means "not configured"; a client id or secret means "intended".
  if ((googleId || googleSecret) && !(googleId && googleSecret && googleCallback)) {
    warnings.push('Google sign-in is partly configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL together, or none');
  }

  // ── CORS ────────────────────────────────────────────────────────────────
  const extraOrigins = splitList(read(env, 'CORS_ORIGINS'));
  const extensionOrigins = splitList(read(env, 'EXTENSION_ORIGINS'));
  for (const [name, list] of [
    ['CORS_ORIGINS', extraOrigins],
    ['EXTENSION_ORIGINS', extensionOrigins],
  ] as const) {
    const bad = list.filter((origin) => !isOrigin(origin));
    if (bad.length) errors.push(`${name} must be comma-separated origins without a path or trailing slash (invalid: ${bad.join(', ')})`);
  }
  if (isProduction && extensionOrigins.length === 0) {
    warnings.push('EXTENSION_ORIGINS is empty: the browser extension cannot call the API. Add chrome-extension://<extension id>');
  }
  const frontendOrigin = frontendUrl && isHttpUrl(frontendUrl) ? new URL(frontendUrl).origin : null;
  const origins = [...new Set([frontendOrigin, ...extraOrigins, ...extensionOrigins].filter((o): o is string => Boolean(o)))];

  // ── Cookies ─────────────────────────────────────────────────────────────
  const rawSecure = read(env, 'COOKIE_SECURE');
  let secure = isProduction;
  if (rawSecure !== undefined) {
    const parsed = parseBoolean(rawSecure);
    if (parsed === null) errors.push(`COOKIE_SECURE must be "true" or "false" (got "${rawSecure}")`);
    else secure = parsed;
  }

  const rawSameSite = read(env, 'COOKIE_SAMESITE')?.toLowerCase();
  // Production keeps the long-standing default (None, for a frontend on another site) as long as
  // cookies are Secure. Without Secure, browsers reject None, so default to Lax instead.
  let sameSite: SameSite = isProduction && secure ? 'none' : 'lax';
  if (rawSameSite !== undefined) {
    if (rawSameSite === 'lax' || rawSameSite === 'strict' || rawSameSite === 'none') sameSite = rawSameSite;
    else errors.push(`COOKIE_SAMESITE must be "lax", "strict" or "none" (got "${rawSameSite}")`);
  }
  if (sameSite === 'none' && !secure) {
    errors.push('COOKIE_SAMESITE=none requires COOKIE_SECURE=true: browsers drop SameSite=None cookies that are not Secure');
  }
  if (isProduction && !secure) {
    warnings.push('COOKIE_SECURE=false in production: the refresh-token cookie can travel over plain HTTP');
  }

  const cookieDomain = read(env, 'COOKIE_DOMAIN');
  if (cookieDomain && !/^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(cookieDomain)) {
    errors.push('COOKIE_DOMAIN must be a bare domain such as .example.com (no scheme, port or path)');
  }

  return {
    config: {
      nodeEnv,
      isProduction,
      port,
      mongoUri,
      mongoDbName,
      redisUrl,
      frontendUrl,
      pyBackendUrl,
      storageProvider,
      cors: { origins, allowLocalDevOrigins: !isProduction },
      cookie: { secure, sameSite, domain: cookieDomain },
      shutdownTimeoutMs,
    },
    errors,
    warnings,
  };
}

export class EnvValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid environment:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

let cached: AppConfig | undefined;

/**
 * Validates `process.env` and returns the typed config. Throws an
 * `EnvValidationError` listing every error. Warnings are logged once.
 */
export function loadConfig(env: Env = process.env, log: Pick<Console, 'warn'> = console): AppConfig {
  const { config, errors, warnings } = checkEnv(env);
  if (errors.length) throw new EnvValidationError(errors);
  for (const warning of warnings) log.warn(`[Config] Warning: ${warning}`);
  cached = config;
  return config;
}

/** The config validated at startup. Falls back to validating the live environment (tests, scripts). */
export function getConfig(): AppConfig {
  return cached ?? checkEnv(process.env).config;
}
