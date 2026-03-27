// =============================================================================
// Graph types — used by graph-service and the web canvas renderer
// =============================================================================

export type GraphNodeType = 'note' | 'tag';
export type GraphEdgeType = 'wikilink' | 'tag';

/**
 * A node in the knowledge graph.
 * - type 'note'  → represents a vault note
 * - type 'tag'   → represents a shared tag (hub node)
 */
export interface GraphNode {
  /** UUID of the underlying note or tag */
  id: string;
  title: string;
  type: GraphNodeType;
  /**
   * Number of notes that share this tag (only meaningful for tag nodes).
   */
  noteCount?: number;
  /**
   * Total number of edges connected to this node (in + out).
   */
  connections: number;
  /** Cached x position from the last layout run */
  x?: number;
  /** Cached y position from the last layout run */
  y?: number;
  /** Optional colour override driven by the note's primary tag */
  color?: string;
}

/**
 * A directed or undirected edge between two graph nodes.
 */
export interface GraphEdge {
  /** ID of the source node */
  source: string;
  /** ID of the target node */
  target: string;
  type: GraphEdgeType;
  /** Weight — can be used to vary edge thickness in visualisations */
  weight?: number;
}

/**
 * The full graph payload returned by the graph-service.
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
}

export interface GraphMetadata {
  totalNodes: number;
  totalEdges: number;
  /** Nodes with zero connections */
  orphanNodes: number;
  /** Timestamp of when the graph was computed / cached */
  computedAt: string;
  vaultId: string;
}

/**
 * Request body for persisting a user-adjusted layout.
 */
export interface SaveLayoutDto {
  vaultId: string;
  positions: Record<string, { x: number; y: number }>;
}

/**
 * Lightweight summary used by sidebar / stats panels.
 */
export interface GraphStats {
  totalNotes: number;
  totalTags: number;
  totalConnections: number;
  mostConnectedNote: { id: string; title: string; connections: number } | null;
  orphanCount: number;
}
