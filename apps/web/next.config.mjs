/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A bank statement CSV is uploaded through a server action; the 1 MB
  // default is too tight for a busy account's month.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  // The API is a separate Nest process. Kept out of next.config rewrites on
  // purpose: the browser calls it directly with a bearer token, so CORS and the
  // token are exercised in development exactly as they will be in production.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api',
  },
};

export default nextConfig;
