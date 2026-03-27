import { DirectedGraph } from 'graphology';
import type Redis from 'ioredis';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface NoteNodeAttributes {
  id: string;
  title: string;
  type: 'note';
  vaultId: string;
  /** Suggested layout hint — set by layout algorithms or default to 0,0 */
  x: number;
  y: number;
  /** Degree-based size hint for rendering */
  size: number;
  /** Community/cluster label, populated when Louvain has been run */
  community?: number;
  updatedAt?: string;
}

export interface EdgeAttributes {
  sourceId: string;
  targetId: string;
  weight: number;
}

export interface GraphNode {
  id: string;
  title: string;
  type: 'note';
  vaultId: string;
  x: number;
  y: number;
  size: number;
  community?: number;
  degree: number;
  inDegree: number;
  outDegree: number;
  updatedAt?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface GraphMetadata {
  vaultId: string;
  nodeCount: number;
  edgeCount: number;
  generatedAt: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
}

// ─── Redis Key Helpers ────────────────────────────────────────────────────────
const REDIS_GRAPH_HASH = 'graph:vaults';

function redisField(vaultId: string): string {
  return vaultId;
}

// ─── Graph Manager ────────────────────────────────────────────────────────────
export class GraphManager {
  /** Per-vault DirectedGraph instances, keyed by vaultId */
  private readonly graphs = new Map<string, DirectedGraph<NoteNodeAttributes, EdgeAttributes>>();

  private redis: Redis | null = null;

  // ── Redis ───────────────────────────────────────────────────────────────────
  setRedis(redis: Redis): void {
    this.redis = redis;
  }

  // ── Get or create a vault graph ─────────────────────────────────────────────
  private getGraph(vaultId: string): DirectedGraph<NoteNodeAttributes, EdgeAttributes> {
    let g = this.graphs.get(vaultId);
    if (!g) {
      g = new DirectedGraph<NoteNodeAttributes, EdgeAttributes>({ multi: false });
      this.graphs.set(vaultId, g);
    }
    return g;
  }

  // ── Persistence helpers ─────────────────────────────────────────────────────
  private async persistVault(vaultId: string): Promise<void> {
    if (!this.redis) return;

    const g = this.graphs.get(vaultId);
    if (!g) return;

    try {
      const serialized = JSON.stringify(g.export());
      await this.redis.hset(REDIS_GRAPH_HASH, redisField(vaultId), serialized);
    } catch (err) {
      console.error('[graph-manager] Failed to persist vault graph:', err);
    }
  }

  /**
   * Load all vault graphs from Redis on startup.
   */
  async loadFromRedis(redis: Redis): Promise<void> {
    this.redis = redis;
    try {
      const allEntries = await redis.hgetall(REDIS_GRAPH_HASH);
      if (!allEntries) return;

      for (const [vaultId, serialized] of Object.entries(allEntries)) {
        try {
          const exported = JSON.parse(serialized) as ReturnType<
            DirectedGraph<NoteNodeAttributes, EdgeAttributes>['export']
          >;
          const g = new DirectedGraph<NoteNodeAttributes, EdgeAttributes>({ multi: false });
          g.import(exported);
          this.graphs.set(vaultId, g);
          console.info(`[graph-manager] Loaded graph for vault ${vaultId}: ${g.order} nodes, ${g.size} edges`);
        } catch (err) {
          console.error(`[graph-manager] Failed to load graph for vault ${vaultId}:`, err);
        }
      }
    } catch (err) {
      console.error('[graph-manager] Failed to load graphs from Redis:', err);
    }
  }

  // ── Node Operations ─────────────────────────────────────────────────────────

  /**
   * Adds a note node to the vault graph.
   * If the node already exists it is updated instead.
   */
  addNote(note: {
    id: string;
    title: string;
    type: 'note';
    vaultId: string;
    updatedAt?: string;
  }): void {
    const g = this.getGraph(note.vaultId);

    if (g.hasNode(note.id)) {
      g.mergeNodeAttributes(note.id, {
        title: note.title,
        updatedAt: note.updatedAt,
      });
    } else {
      g.addNode(note.id, {
        id: note.id,
        title: note.title,
        type: 'note',
        vaultId: note.vaultId,
        x: Math.random() * 1000,
        y: Math.random() * 1000,
        size: 5,
        updatedAt: note.updatedAt,
      });
    }

    this.recalcSizes(note.vaultId);
    void this.persistVault(note.vaultId);
  }

  /**
   * Removes a note node and all its edges from the vault graph.
   */
  removeNote(noteId: string, vaultId: string): void {
    const g = this.graphs.get(vaultId);
    if (!g || !g.hasNode(noteId)) return;

    g.dropNode(noteId);
    this.recalcSizes(vaultId);
    void this.persistVault(vaultId);
  }

  /**
   * Updates attributes on an existing note node.
   */
  updateNote(
    noteId: string,
    vaultId: string,
    attrs: Partial<Omit<NoteNodeAttributes, 'id' | 'vaultId'>>,
  ): void {
    const g = this.graphs.get(vaultId);
    if (!g || !g.hasNode(noteId)) return;

    g.mergeNodeAttributes(noteId, attrs);
    void this.persistVault(vaultId);
  }

  // ── Edge Operations ─────────────────────────────────────────────────────────

  /**
   * Adds a directed edge from sourceId to targetId (wikilink).
   * Both nodes must already exist.
   */
  addWikilink(sourceId: string, targetId: string, vaultId: string): void {
    const g = this.graphs.get(vaultId);
    if (!g) return;

    if (!g.hasNode(sourceId) || !g.hasNode(targetId)) return;

    const edgeKey = `${sourceId}-->${targetId}`;

    if (!g.hasEdge(edgeKey)) {
      g.addDirectedEdgeWithKey(edgeKey, sourceId, targetId, {
        sourceId,
        targetId,
        weight: 1,
      });
    }

    this.recalcSizes(vaultId);
    void this.persistVault(vaultId);
  }

  /**
   * Removes all outbound edges from a source note (used before re-sync).
   */
  removeWikilinks(sourceId: string, vaultId: string): void {
    const g = this.graphs.get(vaultId);
    if (!g || !g.hasNode(sourceId)) return;

    const outEdges = g.outEdges(sourceId);
    for (const edge of outEdges) {
      g.dropEdge(edge);
    }

    this.recalcSizes(vaultId);
    void this.persistVault(vaultId);
  }

  // ── Query Operations ────────────────────────────────────────────────────────

  /**
   * Returns a serialisable GraphData object for the given vault.
   */
  getGraphData(vaultId: string): GraphData {
    const g = this.graphs.get(vaultId);

    if (!g || g.order === 0) {
      return {
        nodes: [],
        edges: [],
        metadata: {
          vaultId,
          nodeCount: 0,
          edgeCount: 0,
          generatedAt: new Date().toISOString(),
        },
      };
    }

    const nodes: GraphNode[] = g.mapNodes((nodeId, attrs) => ({
      id: nodeId,
      title: attrs.title,
      type: attrs.type,
      vaultId: attrs.vaultId,
      x: attrs.x,
      y: attrs.y,
      size: attrs.size,
      community: attrs.community,
      updatedAt: attrs.updatedAt,
      degree: g.degree(nodeId),
      inDegree: g.inDegree(nodeId),
      outDegree: g.outDegree(nodeId),
    }));

    const edges: GraphEdge[] = g.mapEdges((edgeId, attrs) => ({
      id: edgeId,
      source: attrs.sourceId,
      target: attrs.targetId,
      weight: attrs.weight,
    }));

    return {
      nodes,
      edges,
      metadata: {
        vaultId,
        nodeCount: g.order,
        edgeCount: g.size,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Returns a node and its immediate neighbours (in + out).
   */
  getNodeNeighbors(
    nodeId: string,
    vaultId: string,
  ): { node: GraphNode | null; neighbors: GraphNode[] } {
    const g = this.graphs.get(vaultId);

    if (!g || !g.hasNode(nodeId)) {
      return { node: null, neighbors: [] };
    }

    const toGraphNode = (id: string): GraphNode => {
      const attrs = g.getNodeAttributes(id);
      return {
        id,
        title: attrs.title,
        type: attrs.type,
        vaultId: attrs.vaultId,
        x: attrs.x,
        y: attrs.y,
        size: attrs.size,
        community: attrs.community,
        updatedAt: attrs.updatedAt,
        degree: g.degree(id),
        inDegree: g.inDegree(id),
        outDegree: g.outDegree(id),
      };
    };

    const node = toGraphNode(nodeId);
    const neighborIds = g.neighbors(nodeId);
    const neighbors = neighborIds.map(toGraphNode);

    return { node, neighbors };
  }

  /**
   * Returns all nodes with no connections (degree === 0).
   */
  getOrphanNodes(vaultId: string): GraphNode[] {
    const g = this.graphs.get(vaultId);
    if (!g) return [];

    return g
      .filterNodes((id) => g.degree(id) === 0)
      .map((id) => {
        const attrs = g.getNodeAttributes(id);
        return {
          id,
          title: attrs.title,
          type: attrs.type,
          vaultId: attrs.vaultId,
          x: attrs.x,
          y: attrs.y,
          size: attrs.size,
          community: attrs.community,
          updatedAt: attrs.updatedAt,
          degree: 0,
          inDegree: 0,
          outDegree: 0,
        };
      });
  }

  /**
   * Returns the top N most connected nodes by total degree.
   */
  getHubNodes(vaultId: string, topN: number): GraphNode[] {
    const g = this.graphs.get(vaultId);
    if (!g) return [];

    return g
      .mapNodes((id, attrs) => ({
        id,
        title: attrs.title,
        type: attrs.type,
        vaultId: attrs.vaultId,
        x: attrs.x,
        y: attrs.y,
        size: attrs.size,
        community: attrs.community,
        updatedAt: attrs.updatedAt,
        degree: g.degree(id),
        inDegree: g.inDegree(id),
        outDegree: g.outDegree(id),
      }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, topN);
  }

  // ── Size Recalculation ──────────────────────────────────────────────────────

  /**
   * Recalculates node sizes based on their degree, normalised between 5 and 30.
   */
  private recalcSizes(vaultId: string): void {
    const g = this.graphs.get(vaultId);
    if (!g || g.order === 0) return;

    const degrees = g.mapNodes((id) => g.degree(id));
    const maxDegree = Math.max(...degrees, 1);
    const minSize = 5;
    const maxSize = 30;

    g.forEachNode((id) => {
      const deg = g.degree(id);
      const size = minSize + ((deg / maxDegree) * (maxSize - minSize));
      g.setNodeAttribute(id, 'size', size);
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const graphManager = new GraphManager();
