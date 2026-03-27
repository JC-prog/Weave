import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { SWRProvider } from '@/components/providers/SWRProvider'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'NotebookLM Clone — AI-Powered Second Brain',
    template: '%s | NotebookLM Clone',
  },
  description:
    'A powerful AI-powered knowledge base with markdown notes, semantic search, and an interactive knowledge graph.',
  keywords: ['notes', 'knowledge base', 'AI', 'markdown', 'graph', 'obsidian', 'notebooklm'],
  authors: [{ name: 'NotebookLM Clone' }],
  icons: {
    icon: '/favicon.ico',
  },
}

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head />
      <body className={`${inter.variable} font-sans bg-background text-foreground antialiased`}>
        <SWRProvider>{children}</SWRProvider>
      </body>
    </html>
  )
}
