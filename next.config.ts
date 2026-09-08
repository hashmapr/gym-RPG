import type { NextConfig } from "next";

// Sprint 7.5: the native iOS shell (Capacitor) consumes a static export.
// NATIVE_SHELL=1 switches the build to `output: 'export'`; the web build
// (next build) is untouched so API routes + E2E keep working unchanged.
const nativeShell = process.env.NATIVE_SHELL === "1";

const nextConfig: NextConfig = {
  ...(nativeShell
    ? {
        output: "export" as const,
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
