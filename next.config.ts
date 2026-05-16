import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    _AMPLIFY_DATABASE_URL: process.env.DATABASE_URL ?? "",
    _AMPLIFY_NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
    _AMPLIFY_NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "",
  },
};

export default nextConfig;
