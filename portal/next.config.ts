import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable source maps in production to prevent debugger issues
  productionBrowserSourceMaps: false,

  env: {
    NEXT_PUBLIC_ENABLE_AUTH: process.env.ENABLE_AUTH || 'true',
  },
}

export default nextConfig
