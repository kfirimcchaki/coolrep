/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The original platform serves HTML pages with `Cache-Control: max-age=0, no-store`
  // and JSON from /api/* with `vary: Origin` + `access-control-allow-credentials: true`.
  // CORS is applied in middleware.ts so it also applies to error responses.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
    ];
  },
};

export default nextConfig;
