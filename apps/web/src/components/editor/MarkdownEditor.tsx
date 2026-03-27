'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
} from '@codemirror/language'
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { useUpdateNote } from '@/hooks/useNotes'
import { useNotes } from '@/hooks/useNotes'
import { useEditorStore } from '@/store/editorStore'
import { countWords } from '@/lib/utils'
import { EditorToolbar } from './EditorToolbar'
import type { NoteWithRelations } from '@notebooklm/types'
import { Save, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react'

interface MarkdownEditorProps {
  note: NoteWithRelations
  vaultId: string
}

export function MarkdownEditor({ note, vaultId }: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [wordCount, setWordCount] = useState(note.wordCount || 0)
  const [title, setTitle] = useState(note.title)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [frontmatterOpen, setFrontmatterOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const { saveNote, saveNoteNow } = useUpdateNote(vaultId, note.id)
  const { notes } = useNotes(vaultId)
  const { activeVaultId } = useEditorStore()

  // Build wikilink completion from known notes
  const wikilinkCompletion = useCallback(
    (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/\[\[[^\]]*/)
      if (!word) return null

      const query = word.text.slice(2).toLowerCase()
      const options = (notes ?? [])
        .filter((n) => n.id !== note.id)
        .filter((n) => n.title.toLowerCase().includes(query))
        .slice(0, 10)
        .map((n) => ({
          label: `[[${n.title}]]`,
          apply: `[[${n.title}]]`,
          detail: 'note',
          type: 'text',
        }))

      if (options.length === 0) return null

      return {
        from: word.from,
        options,
        validFor: /^\[\[[^\]]*$/,
      }
    },
    [notes, note.id]
  )

  // Initialize editor
  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: note.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        oneDark,
        autocompletion({
          override: [wikilinkCompletion],
          activateOnTyping: true,
        }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          // Cmd+S to save
          {
            key: 'Mod-s',
            run: (view) => {
              saveNoteNow({
                content: view.state.doc.toString(),
                title,
              })
              setSaveStatus('saved')
              return true
            },
          },
          // Cmd+B for bold
          {
            key: 'Mod-b',
            run: (view) => {
              const { from, to } = view.state.selection.main
              const selected = view.state.sliceDoc(from, to)
              view.dispatch(
                view.state.update({
                  changes: { from, to, insert: `**${selected}**` },
                  selection: { anchor: from + 2, head: to + 2 },
                })
              )
              return true
            },
          },
          // Cmd+I for italic
          {
            key: 'Mod-i',
            run: (view) => {
              const { from, to } = view.state.selection.main
              const selected = view.state.sliceDoc(from, to)
              view.dispatch(
                view.state.update({
                  changes: { from, to, insert: `_${selected}_` },
                  selection: { anchor: from + 1, head: to + 1 },
                })
              )
              return true
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const content = update.state.doc.toString()
            const wc = countWords(content)
            setWordCount(wc)
            setSaveStatus('unsaved')

            // Debounced auto-save
            saveNote({ content, title, wordCount: wc })

            // Update save status after debounce
            setTimeout(() => setSaveStatus('saving'), 100)
            setTimeout(() => setSaveStatus('saved'), 1200)
          }
        }),
        EditorView.theme({
          '&': { backgroundColor: 'transparent', height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
      ],
    })

    const view = new EditorView({ state, parent: editorRef.current })
    viewRef.current = view
    setEditorView(view)

    return () => {
      view.destroy()
      viewRef.current = null
      setEditorView(null)
    }
    // Only re-create when note ID changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  // Sync content if note prop changes (e.g. after remote update)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentContent = view.state.doc.toString()
    if (currentContent !== note.content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: note.content },
      })
    }
    setTitle(note.title)
  }, [note.content, note.title])

  async function handleTitleBlur() {
    if (title !== note.title) {
      await saveNoteNow({ title })
    }
  }

  // Frontmatter entries
  const frontmatterEntries = Object.entries(note.frontmatter ?? {})

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <EditorToolbar editorView={editorView} />

      {/* Title */}
      <div className="px-8 pt-6 pb-2 flex-shrink-0">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setSaveStatus('unsaved')
            saveNote({ title: e.target.value })
          }}
          onBlur={handleTitleBlur}
          placeholder="Untitled"
          className="w-full text-3xl font-bold text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/40 focus:outline-none"
        />
      </div>

      {/* Frontmatter (collapsed by default) */}
      {frontmatterEntries.length > 0 && (
        <div className="px-8 pb-3 flex-shrink-0">
          <button
            onClick={() => setFrontmatterOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {frontmatterOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Properties
            <span className="text-muted-foreground/50">({frontmatterEntries.length})</span>
          </button>

          {frontmatterOpen && (
            <div className="mt-2 p-3 rounded-lg border border-border bg-muted/30 space-y-1.5">
              {frontmatterEntries.map(([key, val]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-muted-foreground w-28 flex-shrink-0 truncate">
                    {key}
                  </span>
                  <span className="text-xs text-foreground truncate">
                    {String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editor / Preview toggle row */}
      <div className="px-8 pb-2 flex items-center gap-3 flex-shrink-0">
        <div className="h-px flex-1 bg-border/50" />
        <button
          onClick={() => setPreviewMode((p) => !p)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title={previewMode ? 'Switch to editor' : 'Switch to preview'}
        >
          {previewMode ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {previewMode ? 'Preview' : 'Edit'}
        </button>
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        <div
          ref={editorRef}
          className={`h-full ${previewMode ? 'hidden' : ''}`}
        />
        {previewMode && (
          <MarkdownPreview content={viewRef.current?.state.doc.toString() ?? note.content} />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-8 py-1.5 border-t border-border bg-card/30 text-xs text-muted-foreground flex-shrink-0">
        <div className="flex items-center gap-3">
          <span>{wordCount} words</span>
          <span>{note.content.length} chars</span>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-amber-400">
              <Save className="w-3 h-3 animate-pulse" />
              Saving…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-emerald-500/70">Saved</span>
          )}
          {saveStatus === 'unsaved' && (
            <span className="text-amber-400/70">Unsaved</span>
          )}
          <span className="text-muted-foreground/40">⌘S to save</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Markdown Preview (rendered via react-markdown)
// ---------------------------------------------------------------------------
function MarkdownPreview({ content }: { content: string }) {
  // Dynamic import to avoid SSR issues
  const [ReactMarkdown, setReactMarkdown] = useState<React.ComponentType<{
    children: string
    remarkPlugins?: unknown[]
    components?: Record<string, unknown>
  }> | null>(null)
  const [remarkGfm, setRemarkGfm] = useState<unknown>(null)

  useEffect(() => {
    Promise.all([
      import('react-markdown').then((m) => m.default),
      import('remark-gfm').then((m) => m.default),
    ]).then(([rm, rgfm]) => {
      setReactMarkdown(() => rm)
      setRemarkGfm(() => rgfm)
    })
  }, [])

  if (!ReactMarkdown) {
    return <div className="px-8 py-4 text-muted-foreground text-sm">Loading preview…</div>
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-4">
      <div className="prose max-w-2xl">
        <ReactMarkdown remarkPlugins={remarkGfm ? [remarkGfm] : []}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
