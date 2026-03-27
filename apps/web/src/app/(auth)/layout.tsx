import Link from 'next/link'
import { BrainCircuit } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-8 group">
        <BrainCircuit className="w-7 h-7 text-primary group-hover:scale-110 transition-transform" />
        <span className="text-xl font-semibold text-foreground">NoteAI</span>
      </Link>

      {/* Card */}
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl shadow-black/40 p-8">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-6 text-xs text-muted-foreground text-center">
        By continuing, you agree to our{' '}
        <a href="#" className="underline hover:text-foreground transition-colors">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="#" className="underline hover:text-foreground transition-colors">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  )
}
