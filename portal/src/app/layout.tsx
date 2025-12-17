import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Navigation from '@/components/Navigation'

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

// Log environment variables once at module load time (server-side only)
if (typeof window === 'undefined') {
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
  console.log(
    'OPERATIONS_TABLE_NAME:',
    process.env.OPERATIONS_TABLE_NAME || 'auto-generated'
  )
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Navigation />
        {children}
      </body>
    </html>
  )
}
