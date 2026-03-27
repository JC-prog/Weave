'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Network,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  LogOut,
  Settings,
  BrainCircuit,
  ChevronRight,
} from 'lucide-react'
import { isAuthenticated, clearToken, getUser } from '@/lib/auth'
import { useEditorStore } from '@/store/editorStore'
import { Sidebar } from './Sidebar'
import { ChatPanel } from '@/components/ai/ChatPanel'
import { SearchModal } from '@/components/search/SearchModal'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const {
    sidebarOpen,
    chatPanelOpen,
    searchModalOpen,
    activeVaultId,
    toggleSidebar,
    toggleChatPanel,
    toggleSearchModal,
  } = useEditorStore()

  const [mounted, setMounted] = useState(false)
  const user = mounted ? getUser() : null

  // Auth guard
  useEffect(() => {
    setMounted(true)
    if (!isAuthenticated()) {
      router.replace('/login')
    }
  }, [router])

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+\ — toggle sidebar
      if (meta && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
      // Cmd+J — toggle chat panel
      if (meta && e.key === 'j') {
        e.preventDefault()
        toggleChatPanel()
      }
      // Cmd+K — open search
      if (meta && e.key === 'k') {
        e.preventDefault()
        toggleSearchModal(true)
      }
      // Escape — close search
      if (e.key === 'Escape') {
        if (searchModalOpen) toggleSearchModal(false)
      }
    },
    [toggleSidebar, toggleChatPanel, toggleSearchModal, searchModalOpen]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  // Determine if we're on the graph page
  const isGraphPage = pathname?.includes('/graph')

  if (!mounted) {
    return (
      <div className="flex h-screen bg-background items-center justify-center">
        <BrainCircuit className="w-8 h-8 text-primary animate-pulse" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-border bg-card transition-all duration-200 overflow-hidden ${
          sidebarOpen ? 'w-64 min-w-[256px]' : 'w-0 min-w-0'
        }`}
      >
        {sidebarOpen && <Sidebar />}
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0 h-12">
          {/* Sidebar toggle */}
          <button
            onClick={() => toggleSidebar()}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={`${sidebarOpen ? 'Close' : 'Open'} sidebar (⌘\\)`}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          {/* Breadcrumb / vault name */}
          {activeVaultId && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Link
                href={`/app/vault/${activeVaultId}`}
                className="hover:text-foreground transition-colors"
              >
                Vault
              </Link>
              {isGraphPage && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <span className="text-foreground">Graph</span>
                </>
              )}
            </div>
          )}

          <div className="flex-1" />

          {/* Search trigger */}
          <button
            onClick={() => toggleSearchModal(true)}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
            title="Search (⌘K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search…</span>
            <kbd className="ml-1 px-1 py-0.5 text-xs bg-background rounded border border-border">⌘K</kbd>
          </button>

          {/* Graph view toggle */}
          {activeVaultId && (
            <Link
              href={
                isGraphPage
                  ? `/app/vault/${activeVaultId}`
                  : `/app/vault/${activeVaultId}/graph`
              }
              className={`p-1.5 rounded-md transition-colors ${
                isGraphPage
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="Toggle graph view"
            >
              <Network className="w-4 h-4" />
            </Link>
          )}

          {/* Chat panel toggle */}
          <button
            onClick={() => toggleChatPanel()}
            className={`p-1.5 rounded-md transition-colors ${
              chatPanelOpen
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title="Toggle AI chat (⌘J)"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Mobile search */}
          <button
            onClick={() => toggleSearchModal(true)}
            className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* User menu */}
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => router.push('/app/settings')}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={`Sign out${user?.email ? ` (${user.email})` : ''}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 flex overflow-hidden">
          {children}
        </main>
      </div>

      {/* Right chat panel */}
      <aside
        className={`flex flex-col border-l border-border bg-card transition-all duration-200 overflow-hidden flex-shrink-0 ${
          chatPanelOpen ? 'w-80 min-w-[320px]' : 'w-0 min-w-0'
        }`}
      >
        {chatPanelOpen && <ChatPanel />}
      </aside>

      {/* Search modal */}
      {searchModalOpen && (
        <SearchModal
          onClose={() => toggleSearchModal(false)}
        />
      )}
    </div>
  )
}
