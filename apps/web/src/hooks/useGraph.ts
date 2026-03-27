import useSWR from 'swr'
import { getGraphData } from '@/lib/api'
import type { GraphData } from '@notebooklm/types'

/**
 * Fetch the knowledge graph for a vault.
 * Auto-revalidates when the notes list changes (by depending on the vault ID).
 */
export function useGraphData(vaultId: string | null | undefined) {
  const key = vaultId ? `/api/graph/vaults/${vaultId}` : null

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => getGraphData(vaultId!),
    {
      // Graph can be expensive to compute — don't revalidate too aggressively
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 10_000, // 10 seconds
      refreshInterval: 0,       // manual refresh only
    }
  )

  return {
    graphData: data as GraphData | undefined,
    isLoading,
    error,
    refresh: mutate,
  }
}
