import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Conversation, ChatSource } from '@notebooklm/types'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  createdAt: string
  isStreaming?: boolean
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: UIMessage[]
  isStreaming: boolean
  pendingUserMessage: string
}

interface ChatActions {
  setConversations: (conversations: Conversation[]) => void
  addConversation: (conversation: Conversation) => void
  removeConversation: (conversationId: string) => void
  setActiveConversation: (conversationId: string | null) => void
  setMessages: (messages: UIMessage[]) => void
  addMessage: (message: UIMessage) => void
  appendToLastMessage: (token: string) => void
  setLastMessageSources: (sources: ChatSource[]) => void
  finalizeLastMessage: (fullText: string) => void
  setIsStreaming: (isStreaming: boolean) => void
  setPendingUserMessage: (msg: string) => void
  clearMessages: () => void
}

type ChatStore = ChatState & ChatActions

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // State
      conversations: [],
      activeConversationId: null,
      messages: [],
      isStreaming: false,
      pendingUserMessage: '',

      // Actions
      setConversations: (conversations) => set({ conversations }),

      addConversation: (conversation) =>
        set((state) => ({
          conversations: [conversation, ...state.conversations],
        })),

      removeConversation: (conversationId) =>
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== conversationId),
          activeConversationId:
            state.activeConversationId === conversationId
              ? null
              : state.activeConversationId,
          messages:
            state.activeConversationId === conversationId ? [] : state.messages,
        })),

      setActiveConversation: (conversationId) =>
        set({
          activeConversationId: conversationId,
          messages: [],
          isStreaming: false,
        }),

      setMessages: (messages) => set({ messages }),

      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),

      appendToLastMessage: (token) =>
        set((state) => {
          const messages = [...state.messages]
          if (messages.length === 0) return state
          const last = { ...messages[messages.length - 1] }
          last.content += token
          last.isStreaming = true
          messages[messages.length - 1] = last
          return { messages }
        }),

      setLastMessageSources: (sources) =>
        set((state) => {
          const messages = [...state.messages]
          if (messages.length === 0) return state
          const last = { ...messages[messages.length - 1] }
          last.sources = sources
          messages[messages.length - 1] = last
          return { messages }
        }),

      finalizeLastMessage: (fullText) =>
        set((state) => {
          const messages = [...state.messages]
          if (messages.length === 0) return state
          const last = { ...messages[messages.length - 1] }
          last.content = fullText
          last.isStreaming = false
          messages[messages.length - 1] = last
          return { messages, isStreaming: false }
        }),

      setIsStreaming: (isStreaming) => set({ isStreaming }),

      setPendingUserMessage: (msg) => set({ pendingUserMessage: msg }),

      clearMessages: () => set({ messages: [], isStreaming: false }),
    }),
    {
      name: 'chat-store',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
      ),
      partialize: (state) => ({
        activeConversationId: state.activeConversationId,
        conversations: state.conversations.slice(0, 50), // cap persisted convos
      }),
    }
  )
)
