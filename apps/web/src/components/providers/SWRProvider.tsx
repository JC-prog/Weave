'use client'

import { SWRConfig } from 'swr'
import { apiClient } from '@/lib/api'

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (url: string) => apiClient(url).then((res) => res.json()),
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 2000,
        errorRetryCount: 3,
        errorRetryInterval: 5000,
        onError: (error) => {
          if (error?.status === 401) {
            // Token expired — clear and redirect
            if (typeof window !== 'undefined') {
              localStorage.removeItem('auth_token')
              window.location.href = '/login'
            }
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  )
}
