import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Binary paths are resolved from __dirname; do not bundle them.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  async redirects() {
    return [
      { source: "/pipeline", destination: "/campaigns/workflow", permanent: true },
      { source: "/creator", destination: "/boards/content-creator?tab=library", permanent: true },
    ];
  },
};

export default nextConfig;
