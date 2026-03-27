'use client'

import type { EditorView } from '@codemirror/view'
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  Code,
  Quote,
  List,
  ListOrdered,
  Link,
  Image,
  Minus,
} from 'lucide-react'

interface ToolbarAction {
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  apply: (view: EditorView) => void
}

function wrapSelection(
  view: EditorView,
  before: string,
  after: string = before
) {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const selected = state.sliceDoc(from, to)

  // If already wrapped, unwrap
  const beforeLen = before.length
  const afterLen = after.length
  if (
    from >= beforeLen &&
    state.sliceDoc(from - beforeLen, from) === before &&
    state.sliceDoc(to, to + afterLen) === after
  ) {
    dispatch(
      state.update({
        changes: [
          { from: from - beforeLen, to: from, insert: '' },
          { from: to, to: to + afterLen, insert: '' },
        ],
        selection: { anchor: from - beforeLen, head: to - beforeLen },
      })
    )
  } else {
    dispatch(
      state.update({
        changes: { from, to, insert: `${before}${selected}${after}` },
        selection: {
          anchor: from + beforeLen,
          head: to + beforeLen,
        },
      })
    )
  }
  view.focus()
}

function prefixLine(view: EditorView, prefix: string, toggle = true) {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const line = state.doc.lineAt(from)

  if (toggle && line.text.startsWith(prefix)) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      })
    )
  } else {
    dispatch(
      state.update({
        changes: { from: line.from, insert: prefix },
      })
    )
  }
  view.focus()
}

function insertCodeBlock(view: EditorView) {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const selected = state.sliceDoc(from, to)
  const inserted = selected
    ? `\`\`\`\n${selected}\n\`\`\``
    : '```\n\n```'
  dispatch(
    state.update({
      changes: { from, to, insert: inserted },
      selection: { anchor: from + 4 },
    })
  )
  view.focus()
}

function insertLink(view: EditorView) {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const selected = state.sliceDoc(from, to)
  const inserted = selected ? `[${selected}](url)` : '[link text](url)'
  dispatch(
    state.update({
      changes: { from, to, insert: inserted },
      selection: { anchor: from + 1, head: from + (selected ? selected.length + 1 : 9) },
    })
  )
  view.focus()
}

function insertImagePlaceholder(view: EditorView) {
  const { state, dispatch } = view
  const { from } = state.selection.main
  const inserted = '![alt text](image-url)'
  dispatch(
    state.update({
      changes: { from, insert: inserted },
      selection: { anchor: from + 2, head: from + 10 },
    })
  )
  view.focus()
}

const TOOLBAR_ACTIONS: (ToolbarAction | 'separator')[] = [
  {
    icon: Bold,
    label: 'Bold',
    shortcut: '⌘B',
    apply: (v) => wrapSelection(v, '**'),
  },
  {
    icon: Italic,
    label: 'Italic',
    shortcut: '⌘I',
    apply: (v) => wrapSelection(v, '_'),
  },
  'separator',
  {
    icon: Heading1,
    label: 'Heading 1',
    apply: (v) => prefixLine(v, '# '),
  },
  {
    icon: Heading2,
    label: 'Heading 2',
    apply: (v) => prefixLine(v, '## '),
  },
  {
    icon: Heading3,
    label: 'Heading 3',
    apply: (v) => prefixLine(v, '### '),
  },
  'separator',
  {
    icon: Code,
    label: 'Code block',
    apply: insertCodeBlock,
  },
  {
    icon: Quote,
    label: 'Blockquote',
    apply: (v) => prefixLine(v, '> '),
  },
  'separator',
  {
    icon: List,
    label: 'Bullet list',
    apply: (v) => prefixLine(v, '- '),
  },
  {
    icon: ListOrdered,
    label: 'Numbered list',
    apply: (v) => prefixLine(v, '1. '),
  },
  'separator',
  {
    icon: Link,
    label: 'Insert link',
    apply: insertLink,
  },
  {
    icon: Image,
    label: 'Insert image',
    apply: insertImagePlaceholder,
  },
  'separator',
  {
    icon: Minus,
    label: 'Horizontal rule',
    apply: (v) => {
      const { state, dispatch } = v
      const { from } = state.selection.main
      const line = state.doc.lineAt(from)
      dispatch(
        state.update({
          changes: { from: line.to, insert: '\n\n---\n\n' },
          selection: { anchor: line.to + 7 },
        })
      )
      v.focus()
    },
  },
]

interface EditorToolbarProps {
  editorView: EditorView | null
}

export function EditorToolbar({ editorView }: EditorToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border bg-card/50 overflow-x-auto flex-shrink-0">
      {TOOLBAR_ACTIONS.map((action, i) => {
        if (action === 'separator') {
          return (
            <div
              key={`sep-${i}`}
              className="w-px h-4 bg-border mx-1 flex-shrink-0"
            />
          )
        }

        const Icon = action.icon
        return (
          <button
            key={action.label}
            onClick={() => editorView && action.apply(editorView)}
            disabled={!editorView}
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
            className="flex items-center justify-center p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        )
      })}
    </div>
  )
}
