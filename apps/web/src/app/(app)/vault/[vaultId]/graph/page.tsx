'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { GraphView } from '@/components/graph/GraphView'

interface PageProps {
  params: Promise<{ vaultId: string }>
}

export default function GraphPage({ params }: PageProps) {
  const { vaultId } = use(params)

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Back button overlay */}
      <div className="absolute top-4 left-4 z-10">
        <Link
          href={`/app/vault/${vaultId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card/80 border border-border backdrop-blur-sm text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all shadow-sm"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Link>
      </div>

      {/* Graph fills remaining space */}
      <GraphView vaultId={vaultId} />
    </div>
  )
}
