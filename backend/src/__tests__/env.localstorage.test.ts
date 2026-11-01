import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv } from '../common/config/env';

// Pure: checkEnv takes the environment as an argument, so nothing here touches process.env.

const validProduction = {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://mongo:27017',
  MONGO_DB_NAME: 'open_assets',
  REDIS_URL: 'redis://redis:6379',
  FRONTEND_URL: 'https://app.example.com',
  PY_BACKEND_URL: 'http://py_backend:8000',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  INTERNAL_SERVICE_TOKEN: 'x'.repeat(40),
  INTERNAL_API_TOKEN: 'y'.repeat(40),
  RESEND_API_KEY: 're_123',
  RESEND_FROM_EMAIL: 'noreply@example.com',
  EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
};

test('STORAGE_PROVIDER=local needs no keys in development and reports where files go', () => {
  const { errors, warnings, config } = checkEnv({
    MONGO_URI: 'mongodb://x',
    PORT: '4110',
    STORAGE_PROVIDER: 'local',
    LOCAL_STORAGE_DIR: '/tmp/oa-files',
  });
  assert.deepEqual(errors, []);
  assert.equal(config.storageProvider, 'local');
  assert.deepEqual(config.localStorage, { dir: '/tmp/oa-files', baseUrl: 'http://localhost:4110' });
  const text = warnings.join('\n');
  assert.match(text, /STORAGE_PROVIDER=local/);
  assert.match(text, /AI enhance is not available/);
  assert.doesNotMatch(text, /CLOUDINARY/);
});

test('local storage defaults its directory and honours LOCAL_STORAGE_BASE_URL', () => {
  const { config, warnings } = checkEnv({
    MONGO_URI: 'mongodb://x',
    STORAGE_PROVIDER: 'local',
    LOCAL_STORAGE_BASE_URL: 'http://oa-e2e.localhost:4110/',
  });
  assert.deepEqual(config.localStorage, { dir: './.local-storage', baseUrl: 'http://oa-e2e.localhost:4110' });
  assert.match(warnings.join('\n'), /trailing slash/);

  const bad = checkEnv({ MONGO_URI: 'mongodb://x', STORAGE_PROVIDER: 'local', LOCAL_STORAGE_BASE_URL: 'ftp://x' });
  assert.match(bad.errors.join('\n'), /LOCAL_STORAGE_BASE_URL must be an http/);
});

test('other providers have no local storage settings', () => {
  assert.equal(checkEnv({ MONGO_URI: 'mongodb://x' }).config.localStorage, null);
});

test('production refuses STORAGE_PROVIDER=local unless ALLOW_LOCAL_STORAGE is set', () => {
  const text = checkEnv({ ...validProduction, STORAGE_PROVIDER: 'local' }).errors.join('\n');
  assert.match(text, /STORAGE_PROVIDER=local/);
  assert.match(text, /production refuses it/);
  assert.match(text, /ALLOW_LOCAL_STORAGE=1/);

  for (const value of ['0', 'false', 'yes', '']) {
    const errors = checkEnv({ ...validProduction, STORAGE_PROVIDER: 'local', ALLOW_LOCAL_STORAGE: value }).errors.join('\n');
    assert.match(errors, /production refuses it/, `ALLOW_LOCAL_STORAGE=${JSON.stringify(value)}`);
  }
});

test('production with ALLOW_LOCAL_STORAGE=1 needs the public URL of the API and warns about the trade-offs', () => {
  const base = { ...validProduction, STORAGE_PROVIDER: 'local', ALLOW_LOCAL_STORAGE: '1' };
  assert.match(checkEnv(base).errors.join('\n'), /LOCAL_STORAGE_BASE_URL is required in production/);

  const ok = checkEnv({ ...base, LOCAL_STORAGE_BASE_URL: 'https://api.example.com' });
  assert.deepEqual(ok.errors, []);
  assert.match(ok.warnings.join('\n'), /STORAGE_PROVIDER=local in production/);
});

test('ALLOW_LOCAL_STORAGE does nothing for the other providers', () => {
  const { errors } = checkEnv({ ...validProduction, ALLOW_LOCAL_STORAGE: '1' });
  assert.deepEqual(errors, []);
});

test('production on cloudinary with ALLOW_LOCAL_STORAGE and a LOCAL_STORAGE_DIR warns that old files are served read-only', () => {
  const env = {
    ...validProduction,
    STORAGE_PROVIDER: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'c',
    CLOUDINARY_API_KEY: 'k',
    CLOUDINARY_API_SECRET: 's',
    ALLOW_LOCAL_STORAGE: '1',
    LOCAL_STORAGE_DIR: '/data/files',
  };
  const served = checkEnv(env);
  assert.deepEqual(served.errors, []);
  assert.match(served.warnings.join('\n'), /served read-only at \/storage/);
  assert.doesNotMatch(checkEnv({ ...env, ALLOW_LOCAL_STORAGE: undefined }).warnings.join('\n'), /read-only/);
});
