'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sigma } from 'sigma'
import Graph from 'graphology'
import { circular } from 'graphology-layout'
import type { GraphNode, GraphEdge } from '@notebooklm/types'
import { useGraphData } from '@/hooks/useGraph'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  Loader2,
  AlertCircle,
  Filter,
} from 'lucide-react'

interface GraphViewProps {
  vaultId: string
}

// Node colour mapping
function getNodeColor(node: GraphNode): string {
  if (node.type === 'tag') return '#a855f7' // purple
  if (node.color) return node.color
  // Recent nodes might have been written within a day
  // Size-based colouring
  const c = node.connections
  if (c >= 10) return '#6366f1' // indigo — highly connected
  if (c >= 5) return '#3b82f6'  // blue — moderately connected
  if (c >= 2) return '#22c55e'  // green — lightly connected
  return '#71717a'               // zinc — orphan / isolated
}

function getNodeSize(node: GraphNode): number {
  const base = node.type === 'tag' ? 8 : 6
  const bonus = Math.min(node.connections * 1.5, 12)
  return base + bonus
}

function buildGraphology(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  const graph = new Graph({ multi: false })

  for (const node of nodes) {
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, {
        label: node.title,
        size: getNodeSize(node),
        color: getNodeColor(node),
        x: node.x ?? Math.random() * 10,
        y: node.y ?? Math.random() * 10,
        nodeType: node.type,
        connections: node.connections,
      })
    }
  }

  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      const edgeId = `${edge.source}--${edge.target}`
      if (!graph.hasEdge(edgeId)) {
        try {
          graph.addEdgeWithKey(edgeId, edge.source, edge.target, {
            color: '#3f3f46', // zinc-700
            size: edge.weight ? Math.min(edge.weight * 1.5, 4) : 1,
            type: edge.type,
          })
        } catch {
          // duplicate edge guard
        }
      }
    }
  }

  // Apply circular layout as a starting point if nodes have no positions
  const hasPositions = nodes.some((n) => n.x !== undefined && n.y !== undefined)
  if (!hasPositions) {
    circular.assign(graph)
  }

  return graph
}

export function GraphView({ vaultId }: GraphViewProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const { graphData, isLoading, error, refresh } = useGraphData(vaultId)

  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'note' | 'tag'>('all')

  // Build / update graph when data arrives
  useEffect(() => {
    if (!graphData || !containerRef.current) return

    const nodes =
      filterType === 'all'
        ? graphData.nodes
        : graphData.nodes.filter((n) => n.type === filterType)

    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = graphData.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    )

    const graph = buildGraphology(nodes, edges)
    graphRef.current = graph

    // Destroy existing sigma instance
    if (sigmaRef.current) {
      sigmaRef.current.kill()
      sigmaRef.current = null
    }

    if (!containerRef.current) return

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      allowInvalidContainer: true,
      defaultEdgeColor: '#3f3f46',
      defaultNodeColor: '#6366f1',
      labelColor: { color: '#a1a1aa' },
      labelSize: 11,
      labelFont: 'Inter, system-ui, sans-serif',
      labelWeight: '400',
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
    })

    // Hover: highlight node and neighbors
    sigma.on('enterNode', ({ node, event }) => {
      setHoveredNode(node)
      const label = graph.getNodeAttribute(node, 'label') as string
      const pos = sigma.getNodeDisplayData(node)
      if (pos) {
        setTooltip({
          x: event.x,
          y: event.y,
          label,
        })
      }

      // Dim non-neighbors
      const neighbors = new Set(graph.neighbors(node))
      neighbors.add(node)

      graph.forEachNode((n) => {
        const opacity = neighbors.has(n) ? 1 : 0.15
        graph.setNodeAttribute(n, 'color',
          neighbors.has(n)
            ? getNodeColor(graphData.nodes.find((nd) => nd.id === n)!)
            : '#27272a'
        )
      })

      graph.forEachEdge((edge, attrs, source, target) => {
        const highlight = neighbors.has(source) && neighbors.has(target)
        graph.setEdgeAttribute(edge, 'color', highlight ? '#6366f1' : '#27272a')
        graph.setEdgeAttribute(edge, 'size', highlight ? 2 : 0.5)
      })

      sigma.refresh()
    })

    sigma.on('leaveNode', () => {
      setHoveredNode(null)
      setTooltip(null)

      // Restore original colours
      graph.forEachNode((n) => {
        const nodeData = graphData.nodes.find((nd) => nd.id === n)
        if (nodeData) {
          graph.setNodeAttribute(n, 'color', getNodeColor(nodeData))
        }
      })
      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, 'color', '#3f3f46')
        graph.setEdgeAttribute(edge, 'size', 1)
      })

      sigma.refresh()
    })

    // Mouse move to update tooltip position
    sigma.getMouseCaptor().on('mousemove', (e) => {
      if (hoveredNode) {
        setTooltip((t) => t ? { ...t, x: e.x, y: e.y } : t)
      }
    })

    // Click: navigate to note
    sigma.on('clickNode', ({ node }) => {
      const nodeData = graphData.nodes.find((n) => n.id === node)
      if (nodeData?.type === 'note') {
        router.push(`/app/vault/${vaultId}/notes/${node}`)
      }
    })

    sigmaRef.current = sigma

    return () => {
      sigma.kill()
      sigmaRef.current = null
    }
  }, [graphData, filterType, vaultId, router])

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const camera = sigmaRef.current?.getCamera()
    if (camera) camera.animatedZoom({ duration: 200 })
  }, [])

  const handleZoomOut = useCallback(() => {
    const camera = sigmaRef.current?.getCamera()
    if (camera) camera.animatedUnzoom({ duration: 200 })
  }, [])

  const handleReset = useCallback(() => {
    const camera = sigmaRef.current?.getCamera()
    if (camera) camera.animatedReset({ duration: 300 })
  }, [])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-7 h-7 animate-spin" />
          <p className="text-sm">Building knowledge graph…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AlertCircle className="w-7 h-7 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load graph data.</p>
          <button
            onClick={() => refresh()}
            className="text-xs text-primary hover:text-primary/80 underline transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const nodeCount = graphData?.nodes.length ?? 0
  const edgeCount = graphData?.edges.length ?? 0

  return (
    <div className="flex-1 relative overflow-hidden bg-zinc-950 graph-container">
      {/* Graph canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="graph-tooltip"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 28,
            pointerEvents: 'none',
          }}
        >
          {tooltip.label}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-10">
        <button
          onClick={handleZoomIn}
          className="p-2 rounded-lg bg-card/80 border border-border backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2 rounded-lg bg-card/80 border border-border backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleReset}
          className="p-2 rounded-lg bg-card/80 border border-border backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
          title="Reset view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => refresh()}
          className="p-2 rounded-lg bg-card/80 border border-border backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-all shadow-sm"
          title="Refresh graph"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filter controls */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5 z-10">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        {(['all', 'note', 'tag'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border backdrop-blur-sm transition-all shadow-sm ${
              filterType === type
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'bg-card/80 border-border text-muted-foreground hover:text-foreground hover:bg-card'
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Stats overlay */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="px-3 py-1.5 rounded-lg bg-card/80 border border-border backdrop-blur-sm text-xs text-muted-foreground shadow-sm">
          <span className="font-medium text-foreground">{nodeCount}</span> nodes
          {' · '}
          <span className="font-medium text-foreground">{edgeCount}</span> edges
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-4 left-4 z-10 px-3 py-2 rounded-lg bg-card/80 border border-border backdrop-blur-sm shadow-sm">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Legend</p>
        <div className="space-y-1">
          {[
            { color: '#6366f1', label: 'High connections' },
            { color: '#3b82f6', label: 'Medium' },
            { color: '#22c55e', label: 'Low' },
            { color: '#a855f7', label: 'Tag node' },
            { color: '#71717a', label: 'Isolated' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
