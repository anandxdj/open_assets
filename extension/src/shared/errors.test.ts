import { describe, expect, it } from 'vitest';
import { ApiFailure, failureFromResponse, isPlanLimitCode, pricingUrl, toWorkerError } from './errors';

describe('isPlanLimitCode', () => {
  it('accepts the three plan-limit codes of the backend', () => {
    expect(isPlanLimitCode('SHEET_LIMIT')).toBe(true);
    expect(isPlanLimitCode('PLAN_LIMIT')).toBe(true);
    expect(isPlanLimitCode('PLAN_REQUIRED')).toBe(true);
  });

  it('rejects other codes, case changes and non-strings', () => {
    expect(isPlanLimitCode('INVALID_IMAGE')).toBe(false);
    expect(isPlanLimitCode('RATE_LIMITED')).toBe(false);
    expect(isPlanLimitCode('sheet_limit')).toBe(false);
    expect(isPlanLimitCode('')).toBe(false);
    expect(isPlanLimitCode(undefined)).toBe(false);
    expect(isPlanLimitCode(403)).toBe(false);
    expect(isPlanLimitCode(null)).toBe(false);
  });
});

describe('failureFromResponse', () => {
  it('keeps the message, status and code of an API error body', () => {
    const failure = failureFromResponse(403, { success: false, message: 'You have used all 10 sheets this month.', code: 'SHEET_LIMIT', details: { limit: 10 } }, 'fallback');
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure.message).toBe('You have used all 10 sheets this month.');
    expect(failure.status).toBe(403);
    expect(failure.code).toBe('SHEET_LIMIT');
  });

  it('uses the fallback text when the body has no usable message', () => {
    expect(failureFromResponse(500, null, 'OpenAssets could not start extraction.').message).toBe('OpenAssets could not start extraction.');
    expect(failureFromResponse(500, {}, 'x').message).toBe('x');
    expect(failureFromResponse(500, { message: '   ' }, 'x').message).toBe('x');
    expect(failureFromResponse(500, 'oops', 'x').message).toBe('x');
  });

  it('has no code when the body carries none or a non-string one', () => {
    expect(failureFromResponse(401, { message: 'Invalid or expired token' }, 'x').code).toBeUndefined();
    expect(failureFromResponse(400, { message: 'm', code: 42 }, 'x').code).toBeUndefined();
  });
});

describe('toWorkerError', () => {
  it('forwards the code of an API failure next to the message', () => {
    expect(toWorkerError(new ApiFailure('Used up.', 403, 'SHEET_LIMIT'))).toEqual({ ok: false, error: 'Used up.', code: 'SHEET_LIMIT' });
    expect(toWorkerError(new ApiFailure('Needs Pro.', 403, 'PLAN_REQUIRED'))).toEqual({ ok: false, error: 'Needs Pro.', code: 'PLAN_REQUIRED' });
  });

  it('forwards non plan-limit codes too, so the panel decides what to do with them', () => {
    expect(toWorkerError(new ApiFailure('Only image files are allowed', 415, 'UNSUPPORTED_FILE_TYPE'))).toEqual({ ok: false, error: 'Only image files are allowed', code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('leaves the code out for an API failure without one', () => {
    const result = toWorkerError(new ApiFailure('Invalid or expired token', 401));
    expect(result).toEqual({ ok: false, error: 'Invalid or expired token' });
    expect('code' in result).toBe(false);
  });

  it('keeps the current text for any other error', () => {
    expect(toWorkerError(new Error('Open a webpage with an image first.'))).toEqual({ ok: false, error: 'Open a webpage with an image first.' });
    expect(toWorkerError(new TypeError('Failed to fetch'))).toEqual({ ok: false, error: 'Failed to fetch' });
    expect(toWorkerError('boom')).toEqual({ ok: false, error: 'Unexpected extension error.' });
    expect(toWorkerError(undefined)).toEqual({ ok: false, error: 'Unexpected extension error.' });
  });
});

describe('pricingUrl', () => {
  it('points at the web app plans page', () => {
    expect(pricingUrl('https://openassets.anands.dev')).toBe('https://openassets.anands.dev/pricing');
  });

  it('does not double the slash and keeps a path prefix', () => {
    expect(pricingUrl('http://localhost:3122/')).toBe('http://localhost:3122/pricing');
    expect(pricingUrl('https://example.com/app///')).toBe('https://example.com/app/pricing');
  });
});
