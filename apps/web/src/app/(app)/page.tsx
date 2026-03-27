'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useVaults } from '@/hooks/useVaults'
import { Loader2, BrainCircuit } from 'lucide-react'

export default function AppHomePage() {
  const router = useRouter()
  const { vaults, isLoading, error } = useVaults()

  useEffect(() => {
    if (isLoading) return

    if (error || !vaults || vaults.length === 0) {
      // No vaults yet — stay on page to show creation prompt
      return
    }

    if (vaults.length === 1) {
      // Single vault — navigate directly
      router.replace(`/app/vault/${vaults[0].id}`)
    }
    // Multiple vaults — render the vault selector below
  }, [vaults, isLoading, error, router])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Loading your vaults…</p>
        </div>
      </div>
    )
  }

  if (!vaults || vaults.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-2xl bg-primary/10">
              <BrainCircuit className="w-10 h-10 text-primary" />
            </div>
          </div>
          <h2 className="text-xl font-semibold mb-2">Create your first vault</h2>
          <p className="text-muted-foreground text-sm mb-6">
            A vault is a collection of your notes. Think of it as a project or a knowledge domain.
          </p>
          <CreateVaultPrompt />
        </div>
      </div>
    )
  }

  // Multiple vaults — show selector
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <h2 className="text-xl font-semibold mb-6 text-center">Choose a vault</h2>
        <div className="grid gap-3">
          {vaults.map((vault) => (
            <button
              key={vault.id}
              onClick={() => router.push(`/app/vault/${vault.id}`)}
              className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-all text-left group"
            >
              <div className="p-2.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <BrainCircuit className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{vault.name}</p>
                {vault.description && (
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {vault.description}
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(vault.updatedAt).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function CreateVaultPrompt() {
  const router = useRouter()
  const { createVault, isCreating } = useVaults()

  async function handleCreate() {
    const vault = await createVault({ name: 'My Vault', description: 'My personal knowledge base' })
    if (vault) {
      router.push(`/app/vault/${vault.id}`)
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={isCreating}
      className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium text-sm"
    >
      {isCreating ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Creating…
        </>
      ) : (
        <>
          <BrainCircuit className="w-4 h-4" />
          Create vault
        </>
      )}
    </button>
  )
}
