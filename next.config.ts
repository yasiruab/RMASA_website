import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/**/*"],
  },
};

export default nextConfig;
