'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Link2, ChevronRight, ChevronDown, FileText } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { apiClient } from '@/lib/api'
import { extractExcerpt } from '@/lib/utils'

interface Backlink {
  noteId: string
  noteTitle: string
  excerpt: string
  folderId?: string | null
}

interface BacklinksPanelProps {
  noteId: string
  vaultId: string
}

export function BacklinksPanel({ noteId, vaultId }: BacklinksPanelProps) {
  const [open, setOpen] = useState(true)

  const { data: backlinks, isLoading } = useSWR<Backlink[]>(
    `/api/vaults/${vaultId}/notes/${noteId}/backlinks`,
    () =>
      apiClient(`/api/vaults/${vaultId}/notes/${noteId}/backlinks`)
        .then((r) => r.json())
        .catch(() => [] as Backlink[])
  )

  const count = backlinks?.length ?? 0

  return (
    <aside className="w-56 border-l border-border bg-card/50 flex flex-col flex-shrink-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between px-3 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground border-b border-border transition-colors flex-shrink-0"
      >
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" />
          Backlinks
          {count > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-xs">
              {count}
            </span>
          )}
        </div>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open && (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[1, 2].map((i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                    <div className="h-2 w-full bg-muted/60 rounded animate-pulse" />
                    <div className="h-2 w-3/4 bg-muted/60 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : count === 0 ? (
              <div className="px-2 py-6 text-center">
                <Link2 className="w-5 h-5 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground/60">No backlinks yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1">
                  Other notes that link here will appear.
                </p>
              </div>
            ) : (
              backlinks!.map((bl) => (
                <BacklinkItem key={bl.noteId} backlink={bl} vaultId={vaultId} />
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Individual backlink item
// ---------------------------------------------------------------------------
function BacklinkItem({ backlink, vaultId }: { backlink: Backlink; vaultId: string }) {
  const [expanded, setExpanded] = useState(false)
  const excerpt = backlink.excerpt
    ? extractExcerpt(backlink.excerpt, 120)
    : null

  return (
    <div className="group">
      <div className="flex items-start gap-1.5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-0.5 p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>

        <Link
          href={`/app/vault/${vaultId}/notes/${backlink.noteId}`}
          className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <FileText className="w-3 h-3 flex-shrink-0 opacity-60" />
          <span className="truncate">{backlink.noteTitle}</span>
        </Link>
      </div>

      {expanded && excerpt && (
        <div className="ml-5 mt-1 mb-2 px-2 py-1.5 rounded bg-muted/40 border border-border/50">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
            {excerpt}
          </p>
          <Link
            href={`/app/vault/${vaultId}/notes/${backlink.noteId}`}
            className="text-xs text-primary hover:text-primary/80 mt-1 inline-block transition-colors"
          >
            Open →
          </Link>
        </div>
      )}
    </div>
  )
}
