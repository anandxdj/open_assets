import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError } from 'axios';
import { ApiError } from '../common/utils/ApiError';
import { excaliburFailure } from '../modules/enhance/enhance.controller';

function axiosError(status?: number, code?: string): AxiosError {
  const error = new AxiosError('raw provider text', code);
  if (status !== undefined) {
    error.response = { status, data: 'Traceback (most recent call last)', statusText: '', headers: {}, config: {} as never };
  }
  return error;
}

test('excaliburFailure: the Python service being down is a 502 with plain words', () => {
  for (const error of [axiosError(undefined, 'ECONNREFUSED'), axiosError(500), axiosError(503), new Error('boom')]) {
    const failure = excaliburFailure(error);
    assert.equal(failure.statusCode, 502);
    assert.equal(failure.code, 'ENHANCE_UNAVAILABLE');
    assert.doesNotMatch(failure.message, /ECONN|Traceback|boom|raw provider/);
  }
});

test('excaliburFailure: a 4xx from the service means it rejected the image', () => {
  const failure = excaliburFailure(axiosError(422));
  assert.equal(failure.statusCode, 400);
  assert.equal(failure.code, 'ENHANCE_REJECTED');
  assert.match(failure.message, /different PNG, JPEG or WebP/);
});

test('excaliburFailure keeps an ApiError as it is', () => {
  const original = ApiError.badRequest('Provide a PNG.');
  assert.equal(excaliburFailure(original), original);
});
