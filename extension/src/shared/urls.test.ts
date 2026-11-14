import { describe, expect, it } from 'vitest';
import {
  CHATGPT_MATCH,
  DEFAULT_API_URL,
  DEFAULT_FRONTEND_URL,
  hostPermissionsFor,
  normalizeBaseUrl,
  resolveUrls,
  toMatchPattern,
} from './urls';

describe('normalizeBaseUrl', () => {
  it('falls back when the value is missing, empty or whitespace', () => {
    expect(normalizeBaseUrl(undefined, DEFAULT_API_URL)).toBe(DEFAULT_API_URL);
    expect(normalizeBaseUrl('', DEFAULT_API_URL)).toBe(DEFAULT_API_URL);
    expect(normalizeBaseUrl('   ', DEFAULT_API_URL)).toBe(DEFAULT_API_URL);
  });

  it('trims and strips trailing slashes, query and hash', () => {
    expect(normalizeBaseUrl(' https://api.example.com/ ', DEFAULT_API_URL)).toBe('https://api.example.com');
    expect(normalizeBaseUrl('https://api.example.com///', DEFAULT_API_URL)).toBe('https://api.example.com');
    expect(normalizeBaseUrl('https://api.example.com/v1/?a=1#x', DEFAULT_API_URL)).toBe('https://api.example.com/v1');
  });

  it('keeps a non-default port', () => {
    expect(normalizeBaseUrl('https://api.example.com:8443/', DEFAULT_API_URL)).toBe('https://api.example.com:8443');
  });

  it('allows http only for loopback hosts', () => {
    expect(normalizeBaseUrl('http://localhost:4104', DEFAULT_API_URL)).toBe('http://localhost:4104');
    expect(normalizeBaseUrl('http://127.0.0.1:4104/', DEFAULT_API_URL)).toBe('http://127.0.0.1:4104');
    expect(() => normalizeBaseUrl('http://api.example.com', DEFAULT_API_URL, 'WXT_PUBLIC_API_URL')).toThrow(/https/);
  });

  it('rejects values that are not http(s) URLs and names the variable', () => {
    expect(() => normalizeBaseUrl('api.example.com', DEFAULT_API_URL, 'WXT_PUBLIC_API_URL')).toThrow(/WXT_PUBLIC_API_URL/);
    expect(() => normalizeBaseUrl('ftp://api.example.com', DEFAULT_API_URL)).toThrow();
    expect(() => normalizeBaseUrl('javascript:alert(1)', DEFAULT_API_URL)).toThrow();
  });
});

describe('resolveUrls', () => {
  it('uses the production defaults for an empty env', () => {
    expect(resolveUrls({})).toEqual({ apiUrl: DEFAULT_API_URL, frontendUrl: DEFAULT_FRONTEND_URL });
  });

  it('resolves each variable independently', () => {
    expect(resolveUrls({ WXT_PUBLIC_API_URL: 'https://api.staging.example.com/' })).toEqual({
      apiUrl: 'https://api.staging.example.com',
      frontendUrl: DEFAULT_FRONTEND_URL,
    });
    expect(resolveUrls({ WXT_PUBLIC_FRONTEND_URL: 'http://localhost:3104' })).toEqual({
      apiUrl: DEFAULT_API_URL,
      frontendUrl: 'http://localhost:3104',
    });
  });
});

describe('toMatchPattern', () => {
  it('reduces a URL to its origin match pattern', () => {
    expect(toMatchPattern('https://api.example.com/v1')).toBe('https://api.example.com/*');
    expect(toMatchPattern('http://localhost:4104')).toBe('http://localhost:4104/*');
  });
});

describe('hostPermissionsFor', () => {
  it('lists the API origin and ChatGPT, and never the web app origin', () => {
    const permissions = hostPermissionsFor(resolveUrls({}));
    expect(permissions).toEqual(['https://openasset-backend.anands.dev/*', CHATGPT_MATCH]);
    expect(permissions).not.toContain('https://openassets.anands.dev/*');
  });

  it('follows a custom API domain', () => {
    const permissions = hostPermissionsFor(
      resolveUrls({ WXT_PUBLIC_API_URL: 'https://api.example.org', WXT_PUBLIC_FRONTEND_URL: 'https://example.org' }),
    );
    expect(permissions).toEqual(['https://api.example.org/*', CHATGPT_MATCH]);
  });

  it('adds no localhost permission for a production configuration', () => {
    const permissions = hostPermissionsFor(resolveUrls({}));
    expect(permissions.some((pattern) => /localhost|127\.0\.0\.1/.test(pattern))).toBe(false);
  });

  it('only adds localhost when the env URL asks for it', () => {
    const permissions = hostPermissionsFor(resolveUrls({ WXT_PUBLIC_API_URL: 'http://localhost:4104' }));
    expect(permissions).toEqual(['http://localhost:4104/*', CHATGPT_MATCH]);
  });
});
