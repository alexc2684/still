import type { Metadata, Viewport } from 'next'
import './globals.css'
import ServiceWorker from './ServiceWorker'

export const metadata: Metadata = {
  title: 'Still — A daily practice. A shared presence.',
  description: 'A quiet place to keep your meditation practice, together.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/apple-touch-icon.png' },
}

export const viewport: Viewport = { themeColor: '#f4f2ed', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ServiceWorker />{children}</body></html>
}
