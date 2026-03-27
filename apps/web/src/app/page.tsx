import Link from 'next/link'
import {
  BrainCircuit,
  FileText,
  Network,
  MessageSquare,
  Search,
  ArrowRight,
  Sparkles,
  Github,
} from 'lucide-react'

const features = [
  {
    icon: FileText,
    title: 'Markdown Notes',
    description:
      'Write in plain Markdown with a powerful editor. Support for frontmatter, wikilinks, tables, code blocks, and more.',
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
  },
  {
    icon: Network,
    title: 'Knowledge Graph',
    description:
      'Visualize how your notes connect. See clusters of related ideas emerge as you write and link notes together.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    icon: MessageSquare,
    title: 'AI Chat',
    description:
      'Ask questions about your notes. The AI grounds answers in your vault with source citations and relevant excerpts.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: Search,
    title: 'Semantic Search',
    description:
      'Find notes by meaning, not just keywords. Powered by vector embeddings for intelligent full-text search.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-border/50 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">NoteAI</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm mb-8 animate-fade-in">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Powered by AI · Built for thinkers</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-br from-foreground via-foreground/90 to-foreground/60 bg-clip-text text-transparent">
            Your AI-powered
            <br />
            second brain
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Capture ideas, connect knowledge, and chat with your notes. An Obsidian-inspired
            workspace with NotebookLM-style AI — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all font-medium shadow-lg shadow-primary/20"
            >
              Start for free
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium border border-border"
            >
              Sign in
            </Link>
          </div>

          {/* App Preview Placeholder */}
          <div className="mt-16 relative">
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-2xl shadow-black/50">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
                <div className="flex-1 mx-4 px-3 py-1 bg-background rounded text-xs text-muted-foreground text-left">
                  localhost:3008/app
                </div>
              </div>
              <div className="aspect-[16/9] bg-gradient-to-br from-zinc-900 via-zinc-950 to-black flex items-center justify-center">
                <div className="flex gap-1 opacity-30">
                  {/* Mock sidebar */}
                  <div className="w-48 h-64 bg-zinc-800 rounded" />
                  {/* Mock editor */}
                  <div className="flex-1 h-64 bg-zinc-900 rounded mx-1 p-3 space-y-2">
                    <div className="h-4 bg-zinc-700 rounded w-3/4" />
                    <div className="h-3 bg-zinc-800 rounded w-full" />
                    <div className="h-3 bg-zinc-800 rounded w-5/6" />
                    <div className="h-3 bg-zinc-800 rounded w-4/5" />
                    <div className="h-3 bg-zinc-800 rounded w-full mt-4" />
                    <div className="h-3 bg-zinc-800 rounded w-2/3" />
                  </div>
                  {/* Mock chat */}
                  <div className="w-48 h-64 bg-zinc-800 rounded" />
                </div>
              </div>
            </div>
            {/* Glow effect */}
            <div className="absolute -inset-px bg-gradient-to-r from-primary/20 via-transparent to-accent/20 rounded-xl -z-10 blur-xl opacity-50" />
          </div>
        </section>

        {/* Features */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Everything you need to think clearly</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              A complete knowledge management system designed for how your brain actually works.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="group p-6 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-all"
                >
                  <div className={`inline-flex p-2.5 rounded-lg ${feature.bg} mb-4`}>
                    <Icon className={`w-5 h-5 ${feature.color}`} />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-12 text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to build your second brain?</h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Start free. No credit card required. Import your existing notes from Obsidian or
              Markdown files.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all font-medium shadow-lg shadow-primary/20 text-base"
            >
              Create your vault
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 px-6 py-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4" />
            <span>NoteAI — open source knowledge management</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
