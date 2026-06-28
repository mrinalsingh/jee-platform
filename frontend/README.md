This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Required environment variables on Vercel

The frontend uses a **same-origin proxy** to talk to the NestJS backend on
Render. The backend has CORS off (architecture §5 — same-origin only in v1) and
the auth cookie uses `credentials: 'same-origin'`, so the browser must see one
origin. `next.config.ts` defines an `async rewrites()` block that maps
`/api/:path*` on the Vercel domain to the Render backend, but only when
`BACKEND_API_BASE` is set.

### `BACKEND_API_BASE` — REQUIRED in production

- **Production (Vercel):** set this to the Render backend's public HTTPS URL
  (e.g. `https://jee-platform-api.onrender.com`). Without it, every `/api/*`
  request from the browser hits the Vercel domain and 404s.
- **Preview (Vercel):** set to the staging Render URL, or leave unset if there
  is no staging backend yet.
- **Local development:** leave unset for same-origin localhost flows, or set
  to `http://localhost:4000` (or wherever the local Nest runs) in
  `.env.local` to exercise the proxy path against a local backend.

### Other Vercel env vars (see root `.env.example` for the full list)

- `NEXT_PUBLIC_APP_NAME` — branding shown in the header
- `NEXT_PUBLIC_SENTRY_DSN` — optional client-side error reporting
- `NEXTAUTH_URL` — set to the public Vercel URL in production

No backend secrets (`DATABASE_URL`, `HMAC_PEPPER`, `JWT_SECRET`, SMTP, S3) ever
go on Vercel — they live on Render only.
