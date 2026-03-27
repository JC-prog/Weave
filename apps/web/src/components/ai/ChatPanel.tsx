'use client'

import { useEffect, useRef, useState, useCallback, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Plus,
  Send,
  Loader2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Trash2,
  BookOpen,
  User,
  Bot,
  AlertCircle,
} from 'lucide-react'
import useSWR, { useSWRConfig } from 'swr'
import { useChatStore, type UIMessage } from '@/store/chatStore'
import { useEditorStore } from '@/store/editorStore'
import { getConversations, deleteConversation, createConversation, streamChat } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatRelativeTime } from '@/lib/utils'
import type { ChatSource, Conversation } from '@notebooklm/types'

// ---------------------------------------------------------------------------
// Source citations
// ---------------------------------------------------------------------------
function SourcesBlock({ sources }: { sources: ChatSource[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { activeVaultId } = useEditorStore()

  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-2 border border-border/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <BookOpen className="w-3 h-3 flex-shrink-0" />
        <span className="flex-1 text-left">
          {sources.length} source{sources.length > 1 ? 's' : ''}
        </span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open && (
        <div className="divide-y divide-border/40">
          {sources.map((source, i) => (
            <div key={`${source.noteId}-${i}`} className="px-3 py-2">
              <button
                onClick={() =>
                  activeVaultId &&
                  router.push(`/app/vault/${activeVaultId}/notes/${source.noteId}`)
                }
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors mb-1 text-left"
              >
                {source.noteTitle}
              </button>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                {source.excerpt}
              </p>
              <div className="mt-1 flex items-center gap-1">
                <div
                  className="h-1 rounded-full bg-primary/30"
                  style={{ width: `${Math.round(source.relevanceScore * 100)}%`, maxWidth: '80px' }}
                />
                <span className="text-xs text-muted-foreground/60">
                  {Math.round(source.relevanceScore * 100)}% match
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat message bubble
// ---------------------------------------------------------------------------
function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
          isUser ? 'bg-primary/20' : 'bg-muted'
        }`}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-primary" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${
            isUser
              ? 'bg-primary/20 text-foreground rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-primary/70 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}
        </div>

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="w-full mt-1">
            <SourcesBlock sources={message.sources} />
          </div>
        )}

        <span className="text-xs text-muted-foreground/50 mt-1 px-1">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------
function TypingIndicator() {
  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <Bot className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="px-3 py-2.5 bg-muted rounded-xl rounded-tl-sm">
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ChatPanel
// ---------------------------------------------------------------------------
export function ChatPanel() {
  const { activeVaultId } = useEditorStore()
  const {
    messages,
    isStreaming,
    activeConversationId,
    conversations,
    setConversations,
    setActiveConversation,
    addMessage,
    appendToLastMessage,
    setLastMessageSources,
    finalizeLastMessage,
    setIsStreaming,
    addConversation,
    removeConversation,
    clearMessages,
  } = useChatStore()

  const { mutate: globalMutate } = useSWRConfig()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch conversations
  const { data: convData } = useSWR(
    activeVaultId ? `/api/ai/conversations?vaultId=${activeVaultId}` : null,
    () => getConversations(activeVaultId!),
    { onSuccess: (data) => setConversations(data) }
  )

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  const handleNewConversation = useCallback(() => {
    setActiveConversation(null)
    clearMessages()
  }, [setActiveConversation, clearMessages])

  const handleSelectConversation = useCallback(
    async (conv: Conversation) => {
      setActiveConversation(conv.id)
      setHistoryOpen(false)
      // Fetch messages for this conversation
      try {
        const res = await fetch(`/api/ai/conversations/${conv.id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        })
        if (res.ok) {
          const data = await res.json()
          const uiMessages: UIMessage[] = (data.messages ?? []).map((m: {
            id: string
            role: 'user' | 'assistant'
            content: string
            sources?: ChatSource[]
            createdAt: string
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sources: m.sources,
            createdAt: m.createdAt,
          }))
          useChatStore.getState().setMessages(uiMessages)
        }
      } catch {
        // ignore
      }
    },
    [setActiveConversation]
  )

  const handleDeleteConversation = useCallback(
    async (e: React.MouseEvent, convId: string) => {
      e.stopPropagation()
      removeConversation(convId)
      await deleteConversation(convId)
      globalMutate(`/api/ai/conversations?vaultId=${activeVaultId}`)
    },
    [removeConversation, globalMutate, activeVaultId]
  )

  const handleSend = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const message = input.trim()
      if (!message || isStreaming || !activeVaultId) return

      setInput('')
      setError(null)

      // Add user message
      const userMsg: UIMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
        sources: [],
      }
      addMessage(userMsg)

      // Add placeholder assistant message
      const assistantMsg: UIMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        sources: [],
        isStreaming: true,
      }
      addMessage(assistantMsg)
      setIsStreaming(true)

      // If no conversation yet, create one
      let convId = activeConversationId
      if (!convId) {
        try {
          const conv = await createConversation({
            vaultId: activeVaultId,
            title: message.slice(0, 60),
          })
          convId = conv.id
          setActiveConversation(conv.id)
          addConversation(conv)
        } catch {
          // proceed without conversation ID
        }
      }

      await streamChat(
        message,
        activeVaultId,
        convId,
        (token) => appendToLastMessage(token),
        (sources) => setLastMessageSources(sources),
        (fullText) => {
          finalizeLastMessage(fullText)
          setIsStreaming(false)
        },
        (errMsg) => {
          setError(errMsg)
          setIsStreaming(false)
          finalizeLastMessage('Sorry, an error occurred. Please try again.')
        }
      )
    },
    [
      input,
      isStreaming,
      activeVaultId,
      activeConversationId,
      addMessage,
      setIsStreaming,
      appendToLastMessage,
      setLastMessageSources,
      finalizeLastMessage,
      setActiveConversation,
      addConversation,
    ]
  )

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const displayConversations = convData ?? conversations

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">AI Chat</span>
        </div>
        <button
          onClick={handleNewConversation}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="New conversation"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Conversation history (collapsible) */}
      {displayConversations.length > 0 && (
        <div className="flex-shrink-0 border-b border-border">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {historyOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            History
            <span className="ml-auto text-muted-foreground/50">{displayConversations.length}</span>
          </button>

          {historyOpen && (
            <ScrollArea className="max-h-40">
              <div className="px-2 pb-2 space-y-0.5">
                {displayConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      conv.id === activeConversationId
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                    onClick={() => handleSelectConversation(conv)}
                  >
                    <MessageSquare className="w-3 h-3 flex-shrink-0 opacity-60" />
                    <span className="text-xs truncate flex-1">{conv.title || 'Untitled'}</span>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="px-3 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Bot className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">Ask anything about your notes</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                The AI grounds answers using your vault content
              </p>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
            <TypingIndicator />
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-3 py-3 border-t border-border flex-shrink-0">
        {!activeVaultId && (
          <p className="text-xs text-muted-foreground text-center mb-2">
            Open a vault to start chatting
          </p>
        )}
        <form onSubmit={handleSend} className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeVaultId
                  ? 'Ask about your notes… (Enter to send)'
                  : 'Open a vault first'
              }
              disabled={!activeVaultId || isStreaming}
              rows={1}
              className="w-full resize-none px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-shadow overflow-hidden"
              style={{ minHeight: '38px', maxHeight: '120px' }}
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || !activeVaultId || isStreaming}
            className="flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Send (Enter)"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
        <p className="text-xs text-muted-foreground/40 mt-1.5 text-center">
          Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
