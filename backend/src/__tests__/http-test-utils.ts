import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import { errorHandler } from '../common/middlewares/errorHandler';

// Shared by the HTTP-level tests. Not a test file itself (the `test` script only
// picks up *.test.ts), and kept flat in __tests__ because the script's glob
// would skip top-level test files if a test ever lived in a sub-folder.

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

/** Boots a bare Express app (just the routers under test + the real error handler). */
export async function startTestServer(mount: (app: express.Express) => void): Promise<TestServer> {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  mount(app);
  app.use(errorHandler);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export interface CallResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  setCookies: string[];
}

export async function call(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    setCookies: res.headers.getSetCookie(),
  };
}

/** Value of a Set-Cookie header entry by cookie name, or undefined when absent. */
export function cookieValue(setCookies: string[], name: string): string | undefined {
  const entry = setCookies.find((c) => c.startsWith(`${name}=`));
  return entry?.slice(name.length + 1).split(';')[0];
}
