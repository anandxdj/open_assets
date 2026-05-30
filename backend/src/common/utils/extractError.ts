import axios from 'axios';

/**
 * Extract a human-readable message from any error.
 * For Axios errors from the py_backend, prefer the FastAPI `detail` field.
 */
export function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string' && detail) return `py_backend: ${detail}`;
    if (Array.isArray(detail) && detail.length > 0) {
      // FastAPI validation error array: [{ loc, msg, type }]
      return `py_backend validation: ${detail.map((d: any) => d.msg ?? JSON.stringify(d)).join('; ')}`;
    }
    const status = err.response?.status;
    const url = err.config?.url ?? '';
    return `py_backend HTTP ${status ?? 'network error'} at ${url}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
