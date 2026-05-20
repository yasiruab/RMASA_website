import type { NextConfig } from "next";

// Content-Security-Policy. Enforcing, not report-only.
//
// Host allowlist (kept tight on purpose — every entry corresponds to a script
// or asset actually loaded by the app, verified by grep over src/):
//   - https://www.clarity.ms          inline-bootstrap loads the Clarity tag
//   - https://*.clarity.ms            Clarity beacon hosts (z.clarity.ms etc.)
//   - https://challenges.cloudflare.com  Turnstile widget script + iframe
//   - https://fonts.googleapis.com    Google Fonts stylesheet
//   - https://fonts.gstatic.com       Google Fonts font files
//
// 'unsafe-inline' is required on script-src for the Microsoft Clarity bootstrap
// (an inline <Script> tag in src/app/layout.tsx) and on style-src for the
// inline style attributes that Next.js / React produce. 'unsafe-eval' is only
// added in development — Next.js dev's React Refresh runtime evaluates strings
// as JS, which a strict prod CSP correctly blocks but which would otherwise
// halt the dev bundle before hydration and leave client effects (e.g. the
// bookings calendar's config fetch) never firing. Production builds don't
// need it.
//
// frame-ancestors 'none' duplicates X-Frame-Options: DENY but is the modern
// browser-preferred header.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://www.clarity.ms https://*.clarity.ms https://challenges.cloudflare.com`;
const CSP_DIRECTIVES = [
  "default-src 'self'",
  scriptSrc,
  "connect-src 'self' https://*.clarity.ms https://challenges.cloudflare.com",
  "img-src 'self' data: https://*.clarity.ms",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
].join("; ");

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
    _AMPLIFY_CRON_SECRET: process.env.CRON_SECRET ?? "",
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
          { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
        ],
      },
    ];
  },
};

export default nextConfig;
