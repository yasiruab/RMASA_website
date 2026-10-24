import type { NextConfig } from "next";
import { buildPublicCsp } from "./src/lib/csp";

// Content-Security-Policy. Enforcing, not report-only. Built in src/lib/csp.ts,
// which explains both policies and every allowlisted host. This static one
// covers every route except /admin/*, which gets a stricter per-request nonce
// policy from src/middleware.ts.
const isDev = process.env.NODE_ENV !== "production";
const PUBLIC_CSP = buildPublicCsp(isDev);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    _AMPLIFY_DATABASE_URL: process.env.DATABASE_URL ?? "",
    _AMPLIFY_DIRECT_URL: process.env.DIRECT_URL ?? "",
    _AMPLIFY_NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
    _AMPLIFY_NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "",
    _AMPLIFY_COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? "",
    _AMPLIFY_COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET ?? "",
    _AMPLIFY_COGNITO_ISSUER: process.env.COGNITO_ISSUER ?? "",
    _AMPLIFY_RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
    _AMPLIFY_RESEND_FROM: process.env.RESEND_FROM ?? "",
    _AMPLIFY_ADMIN_NOTIFICATION_EMAIL: process.env.ADMIN_NOTIFICATION_EMAIL ?? "",
    _AMPLIFY_TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
    _AMPLIFY_TURNSTILE_ALLOWED_HOSTNAMES: process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "",
    _AMPLIFY_CRON_SECRET: process.env.CRON_SECRET ?? "",
    // Read by src/app/api/contact/route.ts. Without this line the route's
    // _AMPLIFY_ fallback was always undefined, so the webhook never fired in prod.
    _AMPLIFY_CONTACT_WEBHOOK_URL: process.env.CONTACT_WEBHOOK_URL ?? "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
      {
        // Everything except /admin and /admin/* — those get the strict
        // nonce-based CSP from src/middleware.ts instead. Sending both would
        // be harmless (browsers enforce the intersection) but confusing.
        source: "/((?!admin(?:/|$)).*)",
        headers: [{ key: "Content-Security-Policy", value: PUBLIC_CSP }],
      },
      {
        // Immutable static imagery under /public/. NOTE: on AWS Amplify Hosting,
        // CloudFront overrides these headers for /public/ paths and falls back
        // to a 5 s TTL — see `customHeaders` in amplify.yml, which is the
        // authoritative cache config in production. The rule below is a fallback
        // for non-Amplify environments (Vercel, self-host).
        source: "/:dir(home-sliders|rmasa-hero-banners|logos|activities|events)/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
