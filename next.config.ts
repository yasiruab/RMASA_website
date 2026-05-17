import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    _AMPLIFY_DATABASE_URL: process.env.DATABASE_URL ?? "",
    _AMPLIFY_NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
    _AMPLIFY_NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "",
    _AMPLIFY_COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? "",
    _AMPLIFY_COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET ?? "",
    _AMPLIFY_COGNITO_ISSUER: process.env.COGNITO_ISSUER ?? "",
    _AMPLIFY_RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
    _AMPLIFY_RESEND_FROM: process.env.RESEND_FROM ?? "",
    _AMPLIFY_ADMIN_NOTIFICATION_EMAIL: process.env.ADMIN_NOTIFICATION_EMAIL ?? "",
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
    ];
  },
};

export default nextConfig;
