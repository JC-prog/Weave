'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  FileText,
  Hash,
  Clock,
  X,
  ArrowRight,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { useEditorStore } from '@/store/editorStore'
import { search as apiSearch } from '@/lib/api'
import { debounce } from '@/lib/utils'
import type { SearchResult } from '@/lib/api'

const RECENT_SEARCHES_KEY = 'recent_searches'
const MAX_RECENT = 8

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')
  } catch {
    return []
  }
}

function addRecentSearch(query: string) {
  const recent = getRecentSearches().filter((q) => q !== query)
  const updated = [query, ...recent].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
}

type SearchMode = 'all' | 'fulltext' | 'semantic'

interface SearchModalProps {
  onClose: () => void
}

export function SearchModal({ onClose }: SearchModalProps) {
  const router = useRouter()
  const { activeVaultId } = useEditorStore()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('all')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Load recent searches
  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSearch = useCallback(
    debounce(async (q: string, m: SearchMode) => {
      if (!q.trim() || !activeVaultId) {
        setResults([])
        setIsSearching(false)
        return
      }

      try {
        const data = await apiSearch(q, activeVaultId, m)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300),
    [activeVaultId]
  )

  useEffect(() => {
    if (query.trim()) {
      setIsSearching(true)
      debouncedSearch(query, mode)
    } else {
      setResults([])
      setIsSearching(false)
    }
    setActiveIndex(0)
  }, [query, mode, debouncedSearch])

  function handleNavigate(result: SearchResult) {
    addRecentSearch(query)
    onClose()
    router.push(`/app/vault/${activeVaultId}/notes/${result.noteId}`)
  }

  function handleRecentSearch(recent: string) {
    setQuery(recent)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const total = results.length
    if (total === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % total)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + total) % total)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = results[activeIndex]
      if (selected) handleNavigate(selected)
    }
  }

  const showRecent = !query && recentSearches.length > 0
  const showEmpty = query && !isSearching && results.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {isSearching ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />
          ) : (
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 border border-border rounded"
          >
            Esc
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/20">
          {(['all', 'fulltext', 'semantic'] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                mode === m
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {m === 'semantic' && <Sparkles className="w-3 h-3 inline mr-1" />}
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {/* Recent searches */}
          {showRecent && (
            <div className="py-2">
              <p className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent
              </p>
              {recentSearches.map((recent) => (
                <button
                  key={recent}
                  onClick={() => handleRecentSearch(recent)}
                  className="flex items-center gap-3 w-full px-4 py-2 hover:bg-muted transition-colors text-sm"
                >
                  <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">{recent}</span>
                </button>
              ))}
            </div>
          )}

          {/* Search results */}
          {results.length > 0 && (
            <div className="py-2">
              <p className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {results.length} result{results.length > 1 ? 's' : ''}
              </p>
              {results.map((result, idx) => (
                <SearchResultItem
                  key={result.noteId}
                  result={result}
                  active={idx === activeIndex}
                  query={query}
                  onSelect={() => handleNavigate(result)}
                  onHover={() => setActiveIndex(idx)}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {showEmpty && (
            <div className="text-center py-10">
              <Search className="w-6 h-6 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Try different keywords or switch to semantic search
              </p>
            </div>
          )}

          {/* Initial state */}
          {!query && !showRecent && (
            <div className="text-center py-10">
              <Search className="w-6 h-6 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Start typing to search</p>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground/60">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Individual result item
// ---------------------------------------------------------------------------
interface SearchResultItemProps {
  result: SearchResult
  active: boolean
  query: string
  onSelect: () => void
  onHover: () => void
}

function SearchResultItem({ result, active, query, onSelect, onHover }: SearchResultItemProps) {
  // Highlight matching terms in the excerpt
  function highlightText(text: string, q: string): React.ReactNode {
    if (!q.trim()) return text
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-primary/30 text-foreground rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`flex items-start gap-3 w-full px-4 py-3 transition-colors text-left ${
        active ? 'bg-primary/10' : 'hover:bg-muted'
      }`}
    >
      <div className={`mt-0.5 p-1.5 rounded ${active ? 'bg-primary/20' : 'bg-muted'}`}>
        <FileText className={`w-3.5 h-3.5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-foreground truncate">
            {highlightText(result.noteTitle, query)}
          </p>
          {result.type === 'semantic' && result.score !== undefined && (
            <span className="text-xs text-muted-foreground/60 flex-shrink-0">
              {Math.round(result.score * 100)}%
            </span>
          )}
        </div>
        {result.excerpt && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {highlightText(result.excerpt, query)}
          </p>
        )}
      </div>

      {active && <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
    </button>
  )
}
