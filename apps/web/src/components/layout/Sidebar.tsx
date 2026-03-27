'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  BrainCircuit,
  Plus,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Hash,
  Clock,
  Settings,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import useSWR from 'swr'
import { useEditorStore } from '@/store/editorStore'
import { useVaults } from '@/hooks/useVaults'
import { useNotes, useCreateNote, useDeleteNote } from '@/hooks/useNotes'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TagBadge } from '@/components/ui/badge'
import { getFolders, getTags } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import type { FolderWithChildren, Note, Tag } from '@notebooklm/types'

// ---------------------------------------------------------------------------
// Folder tree
// ---------------------------------------------------------------------------
interface FolderNodeProps {
  folder: FolderWithChildren
  vaultId: string
  depth?: number
  notes: Note[]
  activeNoteId: string | null
}

function FolderNode({ folder, vaultId, depth = 0, notes, activeNoteId }: FolderNodeProps) {
  const [open, setOpen] = useState(depth === 0)
  const router = useRouter()
  const folderNotes = notes.filter((n) => n.folderId === folder.id)

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 w-full px-2 py-1 rounded hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground group"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="text-muted-foreground/60">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        {open ? (
          <FolderOpen className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        ) : (
          <Folder className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
        )}
        <span className="truncate flex-1 text-left">{folder.name}</span>
        {folder.noteCount > 0 && (
          <span className="text-xs text-muted-foreground/50">{folder.noteCount}</span>
        )}
      </button>

      {open && (
        <div>
          {/* Child folders */}
          {folder.children?.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              vaultId={vaultId}
              depth={depth + 1}
              notes={notes}
              activeNoteId={activeNoteId}
            />
          ))}

          {/* Notes in this folder */}
          {folderNotes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              vaultId={vaultId}
              depth={depth + 1}
              active={note.id === activeNoteId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Note item
// ---------------------------------------------------------------------------
interface NoteItemProps {
  note: Note
  vaultId: string
  depth?: number
  active?: boolean
}

function NoteItem({ note, vaultId, depth = 0, active = false }: NoteItemProps) {
  const [showMenu, setShowMenu] = useState(false)
  const { deleteNote } = useDeleteNote(vaultId)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (confirm(`Delete "${note.title}"?`)) {
      await deleteNote(note.id)
    }
    setShowMenu(false)
  }

  return (
    <div className="relative group">
      <Link
        href={`/app/vault/${vaultId}/notes/${note.id}`}
        className={`flex items-center gap-2 py-1 px-2 rounded text-sm transition-colors ${
          active
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground/60'}`} />
        <span className="truncate flex-1">{note.title || 'Untitled'}</span>
      </Link>

      {/* Context menu button */}
      <button
        onClick={(e) => { e.preventDefault(); setShowMenu((s) => !s) }}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-all"
      >
        <MoreHorizontal className="w-3 h-3 text-muted-foreground" />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 top-6 z-50 w-36 bg-popover border border-border rounded-lg shadow-xl py-1">
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Delete note
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Sidebar
// ---------------------------------------------------------------------------
export function Sidebar() {
  const router = useRouter()
  const { activeVaultId, activeNoteId, setActiveVault } = useEditorStore()
  const { vaults } = useVaults()
  const { notes, isLoading: notesLoading } = useNotes(activeVaultId)
  const { createNote, isCreating } = useCreateNote()
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(true)
  const [recentOpen, setRecentOpen] = useState(true)

  const { data: folders } = useSWR(
    activeVaultId ? `/api/vaults/${activeVaultId}/folders` : null,
    () => getFolders(activeVaultId!)
  )

  const { data: tags } = useSWR(
    activeVaultId ? `/api/vaults/${activeVaultId}/tags` : null,
    () => getTags(activeVaultId!)
  )

  const recentNotes = notes
    ?.slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8)

  // Notes without a folder
  const rootNotes = notes?.filter((n) => !n.folderId) ?? []

  const handleNewNote = useCallback(async () => {
    if (!activeVaultId) return
    const note = await createNote(activeVaultId, {
      vaultId: activeVaultId,
      title: 'Untitled',
      content: '# Untitled\n\n',
    })
    if (note) {
      router.push(`/app/vault/${activeVaultId}/notes/${note.id}`)
    }
  }, [activeVaultId, createNote, router])

  return (
    <div className="flex flex-col h-full">
      {/* Vault selector */}
      <div className="px-3 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BrainCircuit className="w-4 h-4 text-primary flex-shrink-0" />
            {vaults && vaults.length > 1 ? (
              <select
                value={activeVaultId ?? ''}
                onChange={(e) => {
                  setActiveVault(e.target.value)
                  router.push(`/app/vault/${e.target.value}`)
                }}
                className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground focus:outline-none truncate cursor-pointer"
              >
                {vaults.map((v) => (
                  <option key={v.id} value={v.id} className="bg-card">
                    {v.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm font-medium text-foreground truncate">
                {vaults?.[0]?.name ?? 'Vault'}
              </span>
            )}
          </div>

          <button
            onClick={handleNewNote}
            disabled={isCreating || !activeVaultId}
            title="New note"
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-1">
          {/* Folder tree */}
          {activeVaultId && (
            <div>
              <button
                onClick={() => setFoldersOpen((o) => !o)}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded hover:bg-muted transition-colors text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {foldersOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Notes
              </button>

              {foldersOpen && (
                <div className="mt-0.5">
                  {notesLoading ? (
                    <div className="px-3 py-2">
                      <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                    </div>
                  ) : (
                    <>
                      {/* Folder nodes */}
                      {folders?.map((folder) => (
                        <FolderNode
                          key={folder.id}
                          folder={folder}
                          vaultId={activeVaultId}
                          notes={notes ?? []}
                          activeNoteId={activeNoteId}
                        />
                      ))}

                      {/* Root-level notes */}
                      {rootNotes.map((note) => (
                        <NoteItem
                          key={note.id}
                          note={note}
                          vaultId={activeVaultId}
                          active={note.id === activeNoteId}
                        />
                      ))}

                      {(!notes || notes.length === 0) && (
                        <p className="px-3 py-2 text-xs text-muted-foreground/60 italic">
                          No notes yet
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tags section */}
          {tags && tags.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setTagsOpen((o) => !o)}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded hover:bg-muted transition-colors text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {tagsOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <Hash className="w-3 h-3" />
                Tags
              </button>

              {tagsOpen && (
                <div className="px-2 py-1.5 flex flex-wrap gap-1.5">
                  {tags.map((tag: Tag) => (
                    <TagBadge
                      key={tag.id}
                      name={tag.name}
                      color={tag.color}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent notes */}
          {recentNotes && recentNotes.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setRecentOpen((o) => !o)}
                className="flex items-center gap-1.5 w-full px-2 py-1 rounded hover:bg-muted transition-colors text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {recentOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <Clock className="w-3 h-3" />
                Recent
              </button>

              {recentOpen && (
                <div className="mt-0.5">
                  {recentNotes.map((note) => (
                    <Link
                      key={note.id}
                      href={`/app/vault/${activeVaultId}/notes/${note.id}`}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                        note.id === activeNoteId
                          ? 'bg-primary/15 text-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      <Clock className="w-3 h-3 flex-shrink-0 opacity-50" />
                      <span className="flex-1 truncate">{note.title || 'Untitled'}</span>
                      <span className="text-muted-foreground/40 flex-shrink-0">
                        {formatRelativeTime(note.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Settings link */}
      <div className="px-2 py-2 border-t border-border flex-shrink-0">
        <Link
          href="/app/settings"
          className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>
      </div>
    </div>
  )
}
