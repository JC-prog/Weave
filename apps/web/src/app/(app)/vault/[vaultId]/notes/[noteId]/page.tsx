'use client'

import { use, useEffect } from 'react'
import { useNote } from '@/hooks/useNotes'
import { useEditorStore } from '@/store/editorStore'
import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { BacklinksPanel } from '@/components/editor/BacklinksPanel'
import { Loader2, AlertCircle } from 'lucide-react'

interface PageProps {
  params: Promise<{ vaultId: string; noteId: string }>
}

export default function NoteEditorPage({ params }: PageProps) {
  const { vaultId, noteId } = use(params)
  const { note, isLoading, error } = useNote(vaultId, noteId)
  const { setActiveNote, setActiveVault } = useEditorStore()

  useEffect(() => {
    setActiveNote(noteId)
    setActiveVault(vaultId)
    return () => {
      // Don't clear on unmount — keep context for sidebar highlight
    }
  }, [noteId, vaultId, setActiveNote, setActiveVault])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-7 h-7 animate-spin" />
          <p className="text-sm">Loading note…</p>
        </div>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground max-w-sm text-center">
          <div className="p-3 rounded-full bg-destructive/10">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <p className="font-medium text-foreground">Note not found</p>
          <p className="text-sm">
            This note may have been deleted or you don&apos;t have access to it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main editor area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarkdownEditor note={note} vaultId={vaultId} />
      </div>

      {/* Backlinks panel */}
      <BacklinksPanel noteId={noteId} vaultId={vaultId} />
    </div>
  )
}
