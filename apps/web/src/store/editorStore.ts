import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface EditorState {
  activeNoteId: string | null
  activeVaultId: string | null
  sidebarOpen: boolean
  chatPanelOpen: boolean
  searchModalOpen: boolean
  graphViewOpen: boolean
}

interface EditorActions {
  setActiveNote: (noteId: string | null) => void
  setActiveVault: (vaultId: string | null) => void
  toggleSidebar: (force?: boolean) => void
  toggleChatPanel: (force?: boolean) => void
  toggleSearchModal: (force?: boolean) => void
  toggleGraphView: (force?: boolean) => void
}

type EditorStore = EditorState & EditorActions

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      // Initial state
      activeNoteId: null,
      activeVaultId: null,
      sidebarOpen: true,
      chatPanelOpen: false,
      searchModalOpen: false,
      graphViewOpen: false,

      // Actions
      setActiveNote: (noteId) => set({ activeNoteId: noteId }),

      setActiveVault: (vaultId) => set({ activeVaultId: vaultId }),

      toggleSidebar: (force) =>
        set((state) => ({
          sidebarOpen: force !== undefined ? force : !state.sidebarOpen,
        })),

      toggleChatPanel: (force) =>
        set((state) => ({
          chatPanelOpen: force !== undefined ? force : !state.chatPanelOpen,
        })),

      toggleSearchModal: (force) =>
        set((state) => ({
          searchModalOpen: force !== undefined ? force : !state.searchModalOpen,
        })),

      toggleGraphView: (force) =>
        set((state) => ({
          graphViewOpen: force !== undefined ? force : !state.graphViewOpen,
        })),
    }),
    {
      name: 'editor-store',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
      ),
      partialize: (state) => ({
        activeVaultId: state.activeVaultId,
        sidebarOpen: state.sidebarOpen,
        chatPanelOpen: state.chatPanelOpen,
      }),
    }
  )
)
