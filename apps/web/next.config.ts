import type { NextConfig } from 'next'

const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3008'],
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${gatewayUrl}/api/:path*`,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
