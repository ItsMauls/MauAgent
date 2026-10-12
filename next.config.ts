import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Binary paths are resolved from __dirname; do not bundle them.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;
