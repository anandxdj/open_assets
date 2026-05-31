import type { NextConfig } from "next";

// SECURITY (#8): the API ships helmet headers, but the Next app users actually
// load shipped none. Add them here. connect-src must include the backend API so
// fetch() still works; img-src allows Cloudinary-hosted assets.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const csp = [
  "default-src 'self'",
  // Next injects inline runtime/styles; 'unsafe-inline' keeps it working without
  // nonces. Tighten to a nonce-based policy later if needed.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://*.cloudinary.com https://lh3.googleusercontent.com https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' ${API_URL} https://res.cloudinary.com https://*.cloudinary.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
