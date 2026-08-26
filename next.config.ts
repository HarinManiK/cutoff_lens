import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The cutoff CSVs are read at request time with a path built at runtime, so Next's
  // dependency tracing cannot see them. Without this they are missing from the
  // serverless bundle and the local-CSV fallback fails in production.
  outputFileTracingIncludes: {
    "/api/cutoffs/**": ["./data/**"],
  },
};

export default nextConfig;
