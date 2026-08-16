import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { optimizePackageImports: ["qrcode.react"] },
};

export default nextConfig;
