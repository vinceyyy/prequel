import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Prequel Interview Platform',
}

// Global flag to ensure environment variables are only logged once
let hasLoggedEnvVars = false

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Debug: Print environment variables on server start (only once)
  if (typeof window === 'undefined' && !hasLoggedEnvVars) {
    console.log('🔧 Environment Variables (server startup):')
    console.log('NODE_ENV:', process.env.NODE_ENV)
    console.log('ENVIRONMENT:', process.env.ENVIRONMENT)
    console.log('PROJECT_PREFIX:', process.env.PROJECT_PREFIX)
    console.log('AWS_REGION:', process.env.AWS_REGION)
    console.log('ENABLE_AUTH:', process.env.ENABLE_AUTH)
    console.log(
      'AUTH_PASSCODE:',
      process.env.AUTH_PASSCODE ? '[SET]' : '[NOT SET]'
    )
    console.log('NEXT_PUBLIC_ENABLE_AUTH:', process.env.NEXT_PUBLIC_ENABLE_AUTH)
    console.log('OPERATIONS_TABLE_NAME:', process.env.OPERATIONS_TABLE_NAME)
    hasLoggedEnvVars = true
  }

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
