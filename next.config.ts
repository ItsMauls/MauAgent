import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Binary paths are resolved from __dirname; do not bundle them. apify-client uses Node-only dynamic requires.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "apify-client"],
  experimental: { serverActions: { bodySizeLimit: "40mb" } }, // library image uploads
  async redirects() {
    return [
      { source: "/pipeline", destination: "/campaigns/workflow", permanent: true },
      { source: "/creator", destination: "/boards/content-creator?tab=library", permanent: true },
    ];
  },
};

export default nextConfig;
