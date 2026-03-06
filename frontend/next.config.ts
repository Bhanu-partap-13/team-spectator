import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Use a different folder name to avoid Windows EPERM locking on `.next`
  distDir: ".next-dist",
};

export default nextConfig;
