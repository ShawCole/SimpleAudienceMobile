/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  },
  // Allow importing shared code from the monorepo root (e.g. ../../../../shared)
  experimental: {
    externalDir: true,
  },
};

module.exports = nextConfig;
