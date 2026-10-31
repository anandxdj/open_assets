import fs from "node:fs";
import { expect, test as setup } from "@playwright/test";
import { API_URL, freshClientAddress } from "./env";
import { AUTH_DIR, PERSONAS, requireE2EPassword, storageStatePath } from "./fixtures";

/**
 * Signs every seeded persona in through the real API and keeps the session
 * cookie (the httpOnly refresh token the web app restores its session from) as
 * Playwright storage state. Tests then start signed in without going through
 * the form, and the sign-in form itself is only shot as a signed-out page.
 */
setup.describe.configure({ mode: "parallel" });

for (const persona of PERSONAS) {
  setup(`sign in as ${persona.key}`, async ({ playwright }) => {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const api = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { "x-forwarded-for": freshClientAddress() },
    });
    const res = await api.post("/api/auth/login", { data: { email: persona.email, password: requireE2EPassword() } });
    expect(res.status(), `login as ${persona.email} (did you run pnpm --dir backend e2e:seed?)`).toBe(200);
    await api.storageState({ path: storageStatePath(persona.key) });
    await api.dispose();
  });
}
