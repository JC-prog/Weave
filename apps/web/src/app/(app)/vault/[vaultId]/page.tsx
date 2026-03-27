'use client'

import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileText,
  Hash,
  Network,
  MessageSquare,
  Plus,
  Upload,
  Clock,
  TrendingUp,
  Loader2,
} from 'lucide-react'
import { useVault } from '@/hooks/useVaults'
import { useNotes, useCreateNote } from '@/hooks/useNotes'
import { useEditorStore } from '@/store/editorStore'
import { useChatStore } from '@/store/chatStore'
import { formatRelativeTime } from '@/lib/utils'

interface PageProps {
  params: Promise<{ vaultId: string }>
}

export default function VaultHomePage({ params }: PageProps) {
  const { vaultId } = use(params)
  const router = useRouter()
  const { vault } = useVault(vaultId)
  const { notes, isLoading: notesLoading } = useNotes(vaultId)
  const { createNote, isCreating } = useCreateNote()
  const { setActiveVault, toggleChatPanel } = useEditorStore()
  const { setActiveConversation } = useChatStore()

  async function handleNewNote() {
    setActiveVault(vaultId)
    const note = await createNote(vaultId, {
      vaultId,
      title: 'Untitled',
      content: '# Untitled\n\n',
    })
    if (note) {
      router.push(`/app/vault/${vaultId}/notes/${note.id}`)
    }
  }

  function handleNewChat() {
    setActiveVault(vaultId)
    setActiveConversation(null)
    toggleChatPanel(true)
  }

  const recentNotes = notes?.slice().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ).slice(0, 8) ?? []

  const totalWords = notes?.reduce((sum, n) => sum + (n.wordCount || 0), 0) ?? 0

  // Collect unique tag count from notes (approximation from titles/slugs)
  const stats = [
    {
      icon: FileText,
      label: 'Notes',
      value: notes?.length ?? 0,
      color: 'text-indigo-400',
      bg: 'bg-indigo-500/10',
    },
    {
      icon: Hash,
      label: 'Tags',
      value: '—',
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
    },
    {
      icon: TrendingUp,
      label: 'Words',
      value: totalWords > 1000 ? `${(totalWords / 1000).toFixed(1)}k` : totalWords,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-1">
            {vault?.name ?? 'Vault'}
          </h1>
          {vault?.description && (
            <p className="text-muted-foreground">{vault.description}</p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-3 mb-8">
          <button
            onClick={handleNewNote}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium text-sm shadow-lg shadow-primary/20"
          >
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            New Note
          </button>

          <Link
            href={`/app/vault/${vaultId}/graph`}
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium text-sm border border-border"
          >
            <Network className="w-4 h-4" />
            View Graph
          </Link>

          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium text-sm border border-border"
          >
            <MessageSquare className="w-4 h-4" />
            AI Chat
          </button>

          <button className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors font-medium text-sm border border-border">
            <Upload className="w-4 h-4" />
            Import
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                className="p-4 rounded-xl border border-border bg-card"
              >
                <div className={`inline-flex p-2 rounded-lg ${stat.bg} mb-3`}>
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
              </div>
            )
          })}
        </div>

        {/* Recent Notes */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">Recent Notes</h2>
            </div>
            {notes && notes.length > 8 && (
              <span className="text-xs text-muted-foreground">{notes.length} total</span>
            )}
          </div>

          {notesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : recentNotes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No notes yet. Create your first note to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/app/vault/${vaultId}/notes/${note.id}`}
                  className="flex items-start gap-3 p-3.5 rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-all group"
                >
                  <div className="p-1.5 rounded bg-muted group-hover:bg-primary/10 transition-colors mt-0.5">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{note.title || 'Untitled'}</p>
                    {note.content && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate-2 leading-relaxed">
                        {note.content.replace(/^#+ .+\n/, '').replace(/[#*`[\]]/g, '').slice(0, 120)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(note.updatedAt)}
                    </span>
                    {note.wordCount > 0 && (
                      <span className="text-xs text-muted-foreground/60">
                        {note.wordCount}w
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
