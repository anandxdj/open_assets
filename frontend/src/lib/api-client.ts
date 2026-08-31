import { tokenStore } from "@/lib/token-store";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const REFRESH_PATH = "/api/auth/refresh-token";

// Shared in-flight refresh so concurrent 401s (e.g. several polls) trigger a
// single refresh-token call instead of stampeding the endpoint.
let refreshPromise: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE_URL}${REFRESH_PATH}`, {
      method: "POST",
      credentials: "include", // sends the httpOnly refreshToken cookie
    })
      .then(async (res) => {
        if (!res.ok) {
          tokenStore.set(null);
          return null;
        }
        const body = (await res.json().catch(() => null)) as
          | { data?: { accessToken?: string } }
          | null;
        const token = body?.data?.accessToken ?? null;
        tokenStore.set(token);
        return token;
      })
      .catch(() => {
        tokenStore.set(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function buildHeaders(isForm: boolean, extra?: HeadersInit): HeadersInit {
  const token = tokenStore.get();
  const headers: Record<string, string> = {};
  // FormData must keep the browser-generated multipart boundary — don't set Content-Type.
  if (!isForm) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return { ...headers, ...(extra as Record<string, string> | undefined) };
}

async function requestWithRetry<T>(
  path: string,
  init: RequestInit,
  isForm = false,
): Promise<T> {
  const send = () =>
    fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: buildHeaders(isForm, init.headers),
    });

  let res = await send();

  // Access token likely expired — refresh once via the cookie, then retry.
  if (res.status === 401 && path !== REFRESH_PATH) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await send();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function postFormBlobWithRetry(path: string, form: FormData): Promise<Blob> {
  const send = () => fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: form,
    credentials: "include",
    headers: buildHeaders(true),
  });
  let res = await send();
  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (token) res = await send();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.blob();
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return requestWithRetry<T>(path, { method: "GET" });
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return requestWithRetry<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  postForm<T>(path: string, form: FormData): Promise<T> {
    return requestWithRetry<T>(path, { method: "POST", body: form }, true);
  },

  postFormBlob(path: string, form: FormData): Promise<Blob> {
    return postFormBlobWithRetry(path, form);
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return requestWithRetry<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return requestWithRetry<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  del<T>(path: string): Promise<T> {
    return requestWithRetry<T>(path, { method: "DELETE" });
  },
};
