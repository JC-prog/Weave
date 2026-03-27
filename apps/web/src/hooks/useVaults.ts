import useSWR, { useSWRConfig } from 'swr'
import { useCallback, useState } from 'react'
import {
  getVaults,
  getVault,
  createVault as apiCreateVault,
  updateVault as apiUpdateVault,
  deleteVault as apiDeleteVault,
} from '@/lib/api'
import type { Vault, CreateVaultDto, UpdateVaultDto } from '@notebooklm/types'

const VAULTS_KEY = '/api/vaults'

// ---------------------------------------------------------------------------
// useVaults — list all vaults for the authenticated user
// ---------------------------------------------------------------------------
export function useVaults() {
  const { data, error, isLoading, mutate } = useSWR(VAULTS_KEY, getVaults, {
    keepPreviousData: true,
  })

  const { mutate: globalMutate } = useSWRConfig()
  const [isCreating, setIsCreating] = useState(false)

  const createVault = useCallback(
    async (data: CreateVaultDto): Promise<Vault | null> => {
      if (isCreating) return null
      setIsCreating(true)
      try {
        const vault = await apiCreateVault(data)
        await globalMutate(VAULTS_KEY)
        return vault
      } catch (err) {
        console.error('Failed to create vault:', err)
        return null
      } finally {
        setIsCreating(false)
      }
    },
    [isCreating, globalMutate]
  )

  return {
    vaults: data,
    isLoading,
    error,
    mutate,
    createVault,
    isCreating,
  }
}

// ---------------------------------------------------------------------------
// useVault — single vault
// ---------------------------------------------------------------------------
export function useVault(vaultId: string | null | undefined) {
  const key = vaultId ? `${VAULTS_KEY}/${vaultId}` : null

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => getVault(vaultId!),
    { keepPreviousData: true }
  )

  const { mutate: globalMutate } = useSWRConfig()

  const updateVault = useCallback(
    async (data: UpdateVaultDto): Promise<Vault | null> => {
      if (!vaultId) return null
      try {
        const updated = await apiUpdateVault(vaultId, data)
        await globalMutate(`${VAULTS_KEY}/${vaultId}`, updated, false)
        await globalMutate(VAULTS_KEY)
        return updated
      } catch (err) {
        console.error('Failed to update vault:', err)
        return null
      }
    },
    [vaultId, globalMutate]
  )

  const deleteVault = useCallback(async (): Promise<boolean> => {
    if (!vaultId) return false
    try {
      await apiDeleteVault(vaultId)
      await globalMutate(VAULTS_KEY)
      return true
    } catch (err) {
      console.error('Failed to delete vault:', err)
      return false
    }
  }, [vaultId, globalMutate])

  return {
    vault: data as Vault | undefined,
    isLoading,
    error,
    mutate,
    updateVault,
    deleteVault,
  }
}
