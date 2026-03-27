import useSWR, { useSWRConfig } from 'swr'
import { useCallback, useRef, useState } from 'react'
import {
  getNotes,
  getNote,
  createNote as apiCreateNote,
  updateNote as apiUpdateNote,
  deleteNote as apiDeleteNote,
} from '@/lib/api'
import { debounce } from '@/lib/utils'
import type { Note, NoteWithRelations, CreateNoteDto, UpdateNoteDto } from '@notebooklm/types'

// ---------------------------------------------------------------------------
// useNotes — list all notes in a vault
// ---------------------------------------------------------------------------
export function useNotes(vaultId: string | null | undefined) {
  const key = vaultId ? `/api/vaults/${vaultId}/notes` : null

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => getNotes(vaultId!).then((res) => res.data),
    { keepPreviousData: true }
  )

  return {
    notes: data as Note[] | undefined,
    isLoading,
    error,
    mutate,
  }
}

// ---------------------------------------------------------------------------
// useNote — single note with relations
// ---------------------------------------------------------------------------
export function useNote(vaultId: string | null, noteId: string | null) {
  const key = vaultId && noteId ? `/api/vaults/${vaultId}/notes/${noteId}` : null

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => getNote(vaultId!, noteId!),
    { revalidateOnFocus: false }
  )

  return {
    note: data as NoteWithRelations | undefined,
    isLoading,
    error,
    mutate,
  }
}

// ---------------------------------------------------------------------------
// useCreateNote — create a new note and revalidate the list
// ---------------------------------------------------------------------------
export function useCreateNote() {
  const { mutate: globalMutate } = useSWRConfig()
  const [isCreating, setIsCreating] = useState(false)

  const createNote = useCallback(
    async (vaultId: string, data: CreateNoteDto): Promise<Note | null> => {
      if (isCreating) return null
      setIsCreating(true)
      try {
        const note = await apiCreateNote(vaultId, data)
        // Revalidate the notes list
        await globalMutate(`/api/vaults/${vaultId}/notes`)
        return note
      } catch (err) {
        console.error('Failed to create note:', err)
        return null
      } finally {
        setIsCreating(false)
      }
    },
    [isCreating, globalMutate]
  )

  return { createNote, isCreating }
}

// ---------------------------------------------------------------------------
// useUpdateNote — debounced auto-save
// ---------------------------------------------------------------------------
export function useUpdateNote(vaultId: string | null, noteId: string | null) {
  const { mutate: globalMutate } = useSWRConfig()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(async (data: UpdateNoteDto) => {
      if (!vaultId || !noteId) return
      try {
        const updated = await apiUpdateNote(vaultId, noteId, data)
        // Update the cached note
        globalMutate(`/api/vaults/${vaultId}/notes/${noteId}`, updated, false)
        // Revalidate list to update word counts / titles
        globalMutate(`/api/vaults/${vaultId}/notes`)
      } catch (err) {
        console.error('Auto-save failed:', err)
      }
    }, 1000),
    [vaultId, noteId, globalMutate]
  )

  const saveNote = useCallback(
    (data: UpdateNoteDto) => {
      debouncedSave(data)
    },
    [debouncedSave]
  )

  // Immediate (non-debounced) save
  const saveNoteNow = useCallback(
    async (data: UpdateNoteDto): Promise<Note | null> => {
      if (!vaultId || !noteId) return null
      try {
        const updated = await apiUpdateNote(vaultId, noteId, data)
        globalMutate(`/api/vaults/${vaultId}/notes/${noteId}`, updated, false)
        globalMutate(`/api/vaults/${vaultId}/notes`)
        return updated
      } catch (err) {
        console.error('Save failed:', err)
        return null
      }
    },
    [vaultId, noteId, globalMutate]
  )

  return { saveNote, saveNoteNow }
}

// ---------------------------------------------------------------------------
// useDeleteNote — delete with optimistic removal from the list cache
// ---------------------------------------------------------------------------
export function useDeleteNote(vaultId: string | null) {
  const { mutate: globalMutate } = useSWRConfig()

  const deleteNote = useCallback(
    async (noteId: string): Promise<boolean> => {
      if (!vaultId) return false

      const listKey = `/api/vaults/${vaultId}/notes`

      // Optimistic update — remove from list immediately
      await globalMutate(
        listKey,
        (current: Note[] | undefined) =>
          current?.filter((n) => n.id !== noteId) ?? [],
        false
      )

      try {
        await apiDeleteNote(vaultId, noteId)
        // Confirm by revalidating
        await globalMutate(listKey)
        return true
      } catch (err) {
        console.error('Delete failed:', err)
        // Rollback
        await globalMutate(listKey)
        return false
      }
    },
    [vaultId, globalMutate]
  )

  return { deleteNote }
}
