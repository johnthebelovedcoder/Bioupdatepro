/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API is a separate Nest process. Kept out of next.config rewrites on
  // purpose: the browser calls it directly with a bearer token, so CORS and the
  // token are exercised in development exactly as they will be in production.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api',
  },
};

export default nextConfig;
