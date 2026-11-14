export const BASE_URL = process.env.E2E_BASE_URL ?? "http://oa-ui5.localhost:3105";
export const API_URL = process.env.E2E_API_URL ?? "http://oa-ui5.localhost:4105";

/**
 * The API rate-limits per client address (a thousand requests per 15 minutes,
 * and ten sign-ins), and the whole suite comes from one address. The API trusts
 * one proxy hop (`trust proxy 1`), so each browser context and each login
 * announces its own address in X-Forwarded-For and gets its own bucket. This
 * changes nothing the app does; it only keeps a long run from throttling itself.
 */
export function freshClientAddress(): string {
  const octet = () => 1 + Math.floor(Math.random() * 254);
  return `10.${octet()}.${octet()}.${octet()}`;
}
