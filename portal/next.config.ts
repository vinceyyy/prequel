import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ENABLE_AUTH: process.env.ENABLE_AUTH || 'true',
  },
}

export default nextConfig
