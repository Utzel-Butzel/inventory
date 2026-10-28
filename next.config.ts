import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/v1/ai/count/3d": ["./services/bulk-3d/{run_job,worker,geometry}.py"],
  },
  outputFileTracingExcludes: {
    "/*": ["./data/bulk-3d/**/*", "./outputs/**/*", "./services/bulk-3d/**/__pycache__/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    useOffline: true,
  },
  async headers() {
    return [
      {
        source: "/notification-sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: "/share/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
