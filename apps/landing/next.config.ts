import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
