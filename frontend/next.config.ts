import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Same-origin proxy to the NestJS backend.
   *
   * Why: backend has CORS off (architecture §5 — same-origin only in v1), and
   * the frontend uses `credentials: 'same-origin'` for the auth cookie. On a
   * Vercel + Render split (different domains), the cookie would not flow.
   *
   * Fix: rewrite `/api/*` on this origin to the Render backend so the browser
   * sees a single origin, the cookie stays valid, and CORS stays off.
   *
   * `BACKEND_API_BASE` must be set on Vercel (production). In local dev with
   * Next.js dev server and a local Nest at http://localhost:4000, set
   * BACKEND_API_BASE=http://localhost:4000 in `.env.local` to exercise the
   * proxy path; otherwise leave unset and rely on the same-origin localhost
   * convention documented in `.env.example`.
   */
  async rewrites() {
    const backendBase = process.env.BACKEND_API_BASE;
    if (!backendBase) {
      // No backend base configured — let same-origin / dev-server defaults stand.
      return [];
    }
    return [
      {
        source: "/api/:path*",
        destination: `${backendBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
