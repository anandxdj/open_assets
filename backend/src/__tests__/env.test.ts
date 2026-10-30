import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, loadConfig, EnvValidationError } from '../common/config/env';

// Pure: checkEnv takes the environment as an argument, so nothing here touches process.env.

const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);

const validProduction = {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://mongo:27017',
  MONGO_DB_NAME: 'open_assets',
  REDIS_URL: 'redis://redis:6379',
  FRONTEND_URL: 'https://app.example.com',
  PY_BACKEND_URL: 'http://py_backend:8000',
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
  INTERNAL_SERVICE_TOKEN: 'x'.repeat(40),
  INTERNAL_API_TOKEN: 'y'.repeat(40),
  CLOUDINARY_CLOUD_NAME: 'cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret-value',
  RESEND_API_KEY: 're_123',
  RESEND_FROM_EMAIL: 'noreply@example.com',
  EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
};

test('a complete production environment has no errors or warnings', () => {
  const { errors, warnings, config } = checkEnv(validProduction);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(config.isProduction, true);
  assert.equal(config.port, 4000);
});

test('an empty production environment lists every required value at once', () => {
  const { errors } = checkEnv({ NODE_ENV: 'production' });
  const text = errors.join('\n');
  for (const name of ['MONGO_URI', 'REDIS_URL', 'FRONTEND_URL', 'PY_BACKEND_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CLOUDINARY_CLOUD_NAME']) {
    assert.match(text, new RegExp(name), `${name} should be reported`);
  }
});

test('development only needs MONGO_URI and falls back to local defaults', () => {
  const { errors, config } = checkEnv({ MONGO_URI: 'mongodb://127.0.0.1:27017' });
  assert.deepEqual(errors, []);
  assert.equal(config.isProduction, false);
  assert.equal(config.redisUrl, 'redis://127.0.0.1:6379');
  assert.equal(config.frontendUrl, 'http://localhost:3000');
  assert.equal(config.cors.allowLocalDevOrigins, true);
});

test('missing MONGO_URI is an error even in development', () => {
  assert.match(checkEnv({}).errors.join('\n'), /MONGO_URI is required/);
});

test('production rejects placeholder, short and identical JWT secrets', () => {
  const placeholder = checkEnv({ ...validProduction, JWT_ACCESS_SECRET: 'change-me-access' }).errors.join('\n');
  assert.match(placeholder, /JWT_ACCESS_SECRET is still the placeholder/);

  const short = checkEnv({ ...validProduction, JWT_REFRESH_SECRET: 'tooshort' }).errors.join('\n');
  assert.match(short, /JWT_REFRESH_SECRET must be at least 32/);

  const same = checkEnv({ ...validProduction, JWT_REFRESH_SECRET: SECRET_A }).errors.join('\n');
  assert.match(same, /must be different values/);
});

test('legacy JWT_SECRET still counts as the access secret', () => {
  const { JWT_ACCESS_SECRET: _omit, ...rest } = validProduction;
  const { errors } = checkEnv({ ...rest, JWT_SECRET: SECRET_A });
  assert.deepEqual(errors, []);
});

test('storage provider typos are caught and each provider needs its own keys', () => {
  assert.match(checkEnv({ ...validProduction, STORAGE_PROVIDER: 'imagekt' }).errors.join('\n'), /STORAGE_PROVIDER must be/);

  const imagekit = checkEnv({ ...validProduction, STORAGE_PROVIDER: 'imagekit' }).errors.join('\n');
  assert.match(imagekit, /IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT/);
  assert.doesNotMatch(imagekit, /CLOUDINARY/);
});

test('missing storage keys are only a warning in development', () => {
  const { errors, warnings } = checkEnv({ MONGO_URI: 'mongodb://127.0.0.1:27017' });
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /CLOUDINARY_CLOUD_NAME/);
});

test('RESEND_API_KEY without a sender address fails in production', () => {
  const { RESEND_FROM_EMAIL: _omit, ...rest } = validProduction;
  assert.match(checkEnv(rest).errors.join('\n'), /RESEND_FROM_EMAIL is required/);
});

test('missing email key, extension origin and service tokens are warnings, not errors', () => {
  const { RESEND_API_KEY: _a, RESEND_FROM_EMAIL: _b, EXTENSION_ORIGINS: _c, INTERNAL_API_TOKEN: _d, INTERNAL_SERVICE_TOKEN: _e, ...rest } = validProduction;
  const { errors, warnings } = checkEnv(rest);
  assert.deepEqual(errors, []);
  const text = warnings.join('\n');
  assert.match(text, /RESEND_API_KEY/);
  assert.match(text, /EXTENSION_ORIGINS/);
  assert.match(text, /INTERNAL_API_TOKEN/);
  assert.match(text, /INTERNAL_SERVICE_TOKEN/);
});

test('cookie defaults: production is Secure with SameSite=None, development is Lax', () => {
  assert.deepEqual(checkEnv(validProduction).config.cookie, { secure: true, sameSite: 'none', domain: undefined });
  assert.deepEqual(checkEnv({ MONGO_URI: 'mongodb://x' }).config.cookie, { secure: false, sameSite: 'lax', domain: undefined });
});

test('cookie settings are driven by env', () => {
  const { config, errors } = checkEnv({ ...validProduction, COOKIE_SAMESITE: 'lax', COOKIE_DOMAIN: '.example.com' });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.cookie, { secure: true, sameSite: 'lax', domain: '.example.com' });
});

test('turning Secure off in production falls back to Lax and warns', () => {
  const { config, errors, warnings } = checkEnv({ ...validProduction, COOKIE_SECURE: 'false' });
  assert.deepEqual(errors, []);
  assert.equal(config.cookie.sameSite, 'lax');
  assert.match(warnings.join('\n'), /COOKIE_SECURE=false in production/);
});

test('SameSite=None without Secure is rejected', () => {
  const { errors } = checkEnv({ ...validProduction, COOKIE_SECURE: 'false', COOKIE_SAMESITE: 'none' });
  assert.match(errors.join('\n'), /COOKIE_SAMESITE=none requires COOKIE_SECURE=true/);
});

test('invalid cookie values are reported', () => {
  const text = checkEnv({
    ...validProduction,
    COOKIE_SECURE: 'maybe',
    COOKIE_SAMESITE: 'sometimes',
    COOKIE_DOMAIN: 'https://example.com/',
  }).errors.join('\n');
  assert.match(text, /COOKIE_SECURE must be/);
  assert.match(text, /COOKIE_SAMESITE must be/);
  assert.match(text, /COOKIE_DOMAIN must be a bare domain/);
});

test('CORS origins: frontend + CORS_ORIGINS + EXTENSION_ORIGINS, deduplicated, no local dev origins', () => {
  const { config, errors } = checkEnv({
    ...validProduction,
    CORS_ORIGINS: 'https://admin.example.com, https://app.example.com',
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.cors.origins, [
    'https://app.example.com',
    'https://admin.example.com',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  ]);
  assert.equal(config.cors.allowLocalDevOrigins, false);
});

test('CORS origins with a path or trailing slash are rejected because they would never match', () => {
  const { errors } = checkEnv({ ...validProduction, CORS_ORIGINS: 'https://admin.example.com/' });
  assert.match(errors.join('\n'), /CORS_ORIGINS must be comma-separated origins/);
});

test('PORT and SHUTDOWN_TIMEOUT_MS are validated', () => {
  assert.equal(checkEnv({ ...validProduction, PORT: '4104' }).config.port, 4104);
  assert.match(checkEnv({ ...validProduction, PORT: 'abc' }).errors.join('\n'), /PORT must be/);
  assert.match(checkEnv({ ...validProduction, PORT: '70000' }).errors.join('\n'), /PORT must be/);
  assert.match(checkEnv({ ...validProduction, SHUTDOWN_TIMEOUT_MS: '10' }).errors.join('\n'), /SHUTDOWN_TIMEOUT_MS/);
});

test('partial Google OAuth configuration warns', () => {
  const { warnings } = checkEnv({ ...validProduction, GOOGLE_CLIENT_ID: 'id' });
  assert.match(warnings.join('\n'), /Google sign-in is partly configured/);
});

test('loadConfig throws one error listing every problem and logs warnings otherwise', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }, { warn: () => {} }),
    (error: unknown) => error instanceof EnvValidationError && error.problems.length > 3 && /MONGO_URI/.test(error.message),
  );

  const logged: string[] = [];
  loadConfig({ MONGO_URI: 'mongodb://127.0.0.1:27017' }, { warn: (message: string) => void logged.push(message) });
  assert.ok(logged.every((line) => line.startsWith('[Config] Warning:')));
});
