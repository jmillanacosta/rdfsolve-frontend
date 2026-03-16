/**
 * View Builder - Pure projection from CanonicalSchema -> PathTree
 */

import type {
  CanonicalSchema,
  CanonicalTriple,
  PathTree,
  PathNode,
  PathEdge,
  NodeType,
} from '../types';
import { getLocalName } from './schema-model';
import { STYLE } from '../layout/styles';

// =============================================================================
// Filtering helpers
// =============================================================================

const SYSTEM_PREFIXES = [
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://www.w3.org/2000/01/rdf-schema#',
  'http://www.w3.org/2002/07/owl#',
  'http://www.w3.org/ns/shacl#',
  'http://www.w3.org/2001/XMLSchema#',
];

const EXCLUDED_LOCAL_NAMES = new Set([
  'Resource', 'Class', 'Literal', 'Property', 'Thing',
  'NamedIndividual', 'Ontology', 'ObjectProperty', 'DatatypeProperty',
]);

function isExcludedNode(uri: string): boolean {
  for (const prefix of SYSTEM_PREFIXES) {
    if (uri.startsWith(prefix)) {
      const local = uri.slice(prefix.length);
      if (local === 'Class' || local === 'type') return false;
      if (EXCLUDED_LOCAL_NAMES.has(local)) return true;
    }
  }
  return false;
}

function isSystemUri(uri: string): boolean {
  return SYSTEM_PREFIXES.some(p => uri.startsWith(p));
}

// =============================================================================
// Triple key (direction-agnostic identity)
// =============================================================================

function tripleKey(t: CanonicalTriple): string {
  return `${t.subject}\t${t.predicate}\t${t.object}`;
}

// =============================================================================
// Node classification
// =============================================================================

function classifyNode(uri: string, schema: CanonicalSchema, isTypeTarget: boolean): NodeType {
  if (uri.startsWith('_:')) return 'blank';
  if (isTypeTarget || schema.classUris.has(uri)) return 'class';
  return 'instance';
}

// =============================================================================
// TreeProjection - per-tree bookkeeping (private, not exported)
// =============================================================================

/**
 * Lightweight bookkeeping for ONE tree being built or expanded.
 * NOT shared across trees - each tree tracks its own state.
 */
class TreeProjection {
  /** Triple keys already in this tree */
  readonly seenTriples = new Set<string>();
  /** URI -> node ID (first registered - used for general lookups) */
  readonly uriToNodeId = new Map<string, string>();
  /** "uri\tcol" -> node ID (used to reuse nodes within the same column) */
  readonly uriColToNodeId = new Map<string, string>();
  /** Max row index per column (for row allocation) */
  readonly columnMaxRow = new Map<number, number>();

  private _nodeCounter = 0;
  private _edgeCounter = 0;

  constructor(private schema: CanonicalSchema, private treeId: string) {}

  // -- ID generators --

  nextNodeId(): string {
    return `${this.treeId}_n${this._nodeCounter++}`;
  }

  nextEdgeId(): string {
    return `${this.treeId}_e${this._edgeCounter++}`;
  }

  // -- Registration --

  registerNode(nodeId: string, uri: string, column: number): boolean {
    if (!this.uriToNodeId.has(uri)) {
      this.uriToNodeId.set(uri, nodeId);
    }
    const key = `${uri}\t${column}`;
    if (this.uriColToNodeId.has(key)) return false; // already exists at this column
    this.uriColToNodeId.set(key, nodeId);
    return true;
  }

  registerTriple(t: CanonicalTriple): boolean {
    const key = tripleKey(t);
    if (this.seenTriples.has(key)) return false;
    this.seenTriples.add(key);
    return true;
  }

  hasTriple(t: CanonicalTriple): boolean {
    return this.seenTriples.has(tripleKey(t));
  }

  getNodeId(uri: string): string | undefined {
    return this.uriToNodeId.get(uri);
  }

  /** Get the node ID for a URI at a specific column, or undefined. */
  getNodeIdAtColumn(uri: string, column: number): string | undefined {
    return this.uriColToNodeId.get(`${uri}\t${column}`);
  }

  // -- Node / Edge factories --

  makeNode(uri: string, column: number, isTypeTarget: boolean): PathNode {
    const id = this.nextNodeId();
    const row = (this.columnMaxRow.get(column) ?? -1) + 1;
    this.columnMaxRow.set(column, row);
    const nodeType = classifyNode(uri, this.schema, isTypeTarget);

    // Look up the schema color for this URI (populated when multiple schemas are merged)
    const schemaColor = this.schema.nodeColorMap?.get(uri);

    return {
      id, uri,
      label: this.labelForUri(uri),
      nodeType,
      x: 0, y: 0,
      width: STYLE.nodeWidth, height: STYLE.nodeHeight,
      column, row,
      inPort: { x: 0, y: 0 }, outPort: { x: 0, y: 0 },
      isTypeNode: nodeType === 'class',
      ...(schemaColor ? { schemaColor } : {}),
    };
  }

  makeEdge(sourceId: string, targetId: string, triple: CanonicalTriple, isIncoming: boolean): PathEdge {
    return {
      id: this.nextEdgeId(),
      sourceId, targetId,
      predicate: triple.predicate,
      label: triple.predicateLabel || getLocalName(triple.predicate),
      isRdfType: triple.isRdfType,
      isIncoming,
      path: '',
    };
  }

  /**
   * Resolve a human-readable label for a URI.
   * Uses the schema.labels map (populated from _labels in JSON-LD),
   * falling back to getLocalName() when no label is available.
   */
  labelForUri(uri: string): string {
    const labels = this.schema.labels;
    if (labels) {
      // Try each prefix to form a CURIE and look it up
      for (const [pfx, ns] of Object.entries(this.schema.prefixes)) {
        if (uri.startsWith(ns)) {
          const curie = `${pfx}:${uri.slice(ns.length)}`;
          if (labels[curie]) return labels[curie];
        }
      }
    }
    return getLocalName(uri);
  }

  /**
   * Rebuild projection state from an existing tree's nodes and edges.
   * Used when expanding so row allocation and dedup continue correctly.
   */
  syncFromTree(tree: PathTree): void {
    // Sync nodes
    for (const node of tree.nodes) {
      if (!this.uriToNodeId.has(node.uri)) {
        this.uriToNodeId.set(node.uri, node.id);
      }
      this.uriColToNodeId.set(`${node.uri}\t${node.column}`, node.id);
      const cur = this.columnMaxRow.get(node.column) ?? -1;
      if (node.row > cur) this.columnMaxRow.set(node.column, node.row);
    }

    // Sync edges -> reconstruct triple keys
    for (const edge of tree.edges) {
      const srcNode = tree.nodes.find(n => n.id === edge.sourceId);
      const tgtNode = tree.nodes.find(n => n.id === edge.targetId);
      if (srcNode && tgtNode) {
        // Reconstruct canonical triple direction
        const s = edge.isIncoming ? tgtNode.uri : srcNode.uri;
        const o = edge.isIncoming ? srcNode.uri : tgtNode.uri;
        this.seenTriples.add(`${s}\t${edge.predicate}\t${o}`);
      }
    }

    // Advance counters past existing IDs
    this._nodeCounter = tree.nodes.length;
    this._edgeCounter = tree.edges.length;
  }
}

// =============================================================================
// Public types
// =============================================================================

export interface BuildOptions {
  /** Maximum depth to traverse from root (default: 10) */
  maxDepth?: number;
  /** Filter out OWL/RDFS system nodes (default: true) */
  excludeSystemNodes?: boolean;
}

export interface ExpandOptions {
  /** Which direction to expand (default: 'both') */
  direction?: 'outgoing' | 'incoming' | 'both';
  /** How many levels deep from anchor (default: 1) */
  maxDepth?: number;
  /** Max neighbours per direction per level (default: 50) */
  maxBranching?: number;
  /** Specific node ID to expand (when the same URI exists at multiple columns) */
  nodeId?: string;
}

export interface ExpandResult {
  nodesAdded: number;
  edgesAdded: number;
}

// =============================================================================
// Public API - pure functions
// =============================================================================

/**
 * Project a tree from the graph starting at `rootUri`.
 * Walks outgoing edges to `maxDepth`, then adds incoming edges at depth 1
 * for the root so the tree shows bidirectional context.
 */
export function buildTree(
  graph: CanonicalSchema,
  rootUri: string,
  options: BuildOptions = {},
): PathTree {
  const { maxDepth = 1, excludeSystemNodes = true } = options;
  const treeId = `t_${rootUri.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const proj = new TreeProjection(graph, treeId);

  const nodes: PathNode[] = [];
  const edges: PathEdge[] = [];

  // Create root node
  const rootNode = proj.makeNode(rootUri, 0, false);
  proj.registerNode(rootNode.id, rootUri, 0);
  nodes.push(rootNode);

  // Walk outgoing recursively
  walkOutgoing(graph, proj, rootUri, rootNode.id, 0, maxDepth, excludeSystemNodes, nodes, edges, new Set([rootUri]));

  // Show incoming at depth 1 for the root (non-recursive)
  walkIncoming(graph, proj, rootUri, rootNode.id, 0, 1, excludeSystemNodes, nodes, edges);

  return {
    id: treeId,
    rootUri,
    rootLabel: rootNode.label,
    nodes, edges,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  };
}

/**
 * Build independent trees for multiple root URIs.
 * Each tree has its own projection state.
 */
export function buildTrees(
  graph: CanonicalSchema,
  rootUris: string[],
  options: BuildOptions = {},
): PathTree[] {
  const trees: PathTree[] = [];
  for (const uri of rootUris) {
    const tree = buildTree(graph, uri, options);
    if (tree.nodes.length > 0) trees.push(tree);
  }
  return trees;
}

/**
 * Expand a node that's already in `tree`. Adds unseen connections from the
 * graph into the tree's nodes/edges arrays (mutates in place).
 *
 * @returns Counts of added nodes/edges, or null if nodeUri is not in the tree.
 */
export function expandTree(
  graph: CanonicalSchema,
  tree: PathTree,
  nodeUri: string,
  options: ExpandOptions = {},
): ExpandResult | null {
  const {
    direction = 'both',
    maxDepth = 1,
    maxBranching = 50,
    nodeId: explicitNodeId,
  } = options;

  // Rebuild projection from existing tree
  const proj = new TreeProjection(graph, tree.id);
  proj.syncFromTree(tree);

  // Use explicit nodeId if provided (handles URIs at multiple columns),
  // otherwise fall back to first registered node for this URI.
  const nodeId = explicitNodeId ?? proj.getNodeId(nodeUri);
  if (!nodeId) return null;

  const anchorNode = tree.nodes.find(n => n.id === nodeId);
  if (!anchorNode) return null;

  const beforeNodes = tree.nodes.length;
  const beforeEdges = tree.edges.length;
  const depthLimit = anchorNode.column + maxDepth;

  if (direction === 'outgoing' || direction === 'both') {
    walkOutgoing(graph, proj, nodeUri, nodeId, anchorNode.column, depthLimit, true, tree.nodes, tree.edges, new Set([nodeUri]), maxBranching);
  }
  if (direction === 'incoming' || direction === 'both') {
    walkIncoming(graph, proj, nodeUri, nodeId, anchorNode.column, maxDepth, true, tree.nodes, tree.edges, maxBranching);
  }

  return {
    nodesAdded: tree.nodes.length - beforeNodes,
    edgesAdded: tree.edges.length - beforeEdges,
  };
}

/**
 * Count connections for a node: total in the graph AND unseen in this tree.
 * This lets the UI show "5 of 12 outgoing rendered" or "expand 7 more".
 */
export function getNodeStats(
  graph: CanonicalSchema,
  tree: PathTree,
  nodeUri: string,
): {
  outgoing: number;      // total outgoing in the graph
  incoming: number;      // total incoming in the graph
  unseenOutgoing: number; // not yet rendered in this tree
  unseenIncoming: number;
  total: number;         // total unseen (for backward compat)
} {
  // Build set of rendered triple keys for this tree
  const rendered = new Set<string>();
  for (const edge of tree.edges) {
    const src = tree.nodes.find(n => n.id === edge.sourceId);
    const tgt = tree.nodes.find(n => n.id === edge.targetId);
    if (src && tgt) {
      const s = edge.isIncoming ? tgt.uri : src.uri;
      const o = edge.isIncoming ? src.uri : tgt.uri;
      rendered.add(`${s}\t${edge.predicate}\t${o}`);
    }
  }

  const outTriples = (graph.outgoing.get(nodeUri) || [])
    .filter(t => t.objectType === 'uri' && !isSystemUri(t.object));
  const inTriples = (graph.incoming.get(nodeUri) || [])
    .filter(t => !t.isRdfType && !isSystemUri(t.subject));

  const unseenOut = outTriples.filter(t => !rendered.has(tripleKey(t))).length;
  const unseenIn = inTriples.filter(t => !rendered.has(tripleKey(t))).length;

  return {
    outgoing: outTriples.length,
    incoming: inTriples.length,
    unseenOutgoing: unseenOut,
    unseenIncoming: unseenIn,
    total: unseenOut + unseenIn,
  };
}

/**
 * Return URIs sorted by connectivity that are good candidates for tree roots.
 */
export function getAvailableRoots(
  graph: CanonicalSchema,
): Array<{ uri: string; label: string; outDegree: number }> {
  const roots: Array<{ uri: string; label: string; outDegree: number }> = [];
  for (const uri of graph.subjects) {
    if (isExcludedNode(uri)) continue;
    const outDegree = graph.outgoing.get(uri)?.length || 0;
    if (outDegree === 0) continue;
    // Prefer human label from the labels map, fall back to local name
    let label = getLocalName(uri);
    if (graph.labels) {
      for (const [pfx, ns] of Object.entries(graph.prefixes)) {
        if (uri.startsWith(ns)) {
          const curie = `${pfx}:${uri.slice(ns.length)}`;
          if (graph.labels[curie]) { label = graph.labels[curie]; break; }
        }
      }
    }
    roots.push({ uri, label, outDegree });
  }
  roots.sort((a, b) => b.outDegree - a.outDegree);
  return roots;
}

/**
 * Build a nodeId -> URI map from a set of trees.
 * Useful for SPARQL generation and other cross-cutting concerns.
 */
export function getNodeIdToUriMap(trees: PathTree[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tree of trees) {
    for (const node of tree.nodes) {
      map.set(node.id, node.uri);
    }
  }
  return map;
}

// =============================================================================
// Internal: recursive graph walkers
// =============================================================================

/**
 * Walk outgoing edges (subject -> object) from `uri`, adding unseen nodes/edges.
 */
function walkOutgoing(
  graph: CanonicalSchema,
  proj: TreeProjection,
  uri: string,
  nodeId: string,
  currentColumn: number,
  maxDepth: number,
  excludeSystem: boolean,
  nodes: PathNode[],
  edges: PathEdge[],
  visited: Set<string>,
  maxBranching = 200,
): void {
  if (currentColumn >= maxDepth) return;

  const triples = graph.outgoing.get(uri) || [];
  const nextCol = currentColumn + 1;
  let count = 0;

  for (const triple of triples) {
    if (count >= maxBranching) break;
    if (triple.objectType !== 'uri') continue;
    if (excludeSystem && isExcludedNode(triple.object)) continue;
    if (proj.hasTriple(triple)) continue;

    // Reuse node if this URI already exists at nextCol (e.g. from incoming walk),
    // otherwise create a fresh node. Never reuse nodes at a different column.
    let targetId = proj.getNodeIdAtColumn(triple.object, nextCol);
    let wasCreated = false;

    if (!targetId) {
      const newNode = proj.makeNode(triple.object, nextCol, triple.isRdfType);
      proj.registerNode(newNode.id, triple.object, nextCol);
      nodes.push(newNode);
      targetId = newNode.id;
      wasCreated = true;
    }

    // Add edge
    edges.push(proj.makeEdge(nodeId, targetId, triple, false));
    proj.registerTriple(triple);
    count++;

    // Recurse into newly created nodes
    if (wasCreated && !visited.has(triple.object)) {
      visited.add(triple.object);
      walkOutgoing(graph, proj, triple.object, targetId, nextCol, maxDepth, excludeSystem, nodes, edges, visited, maxBranching);
      visited.delete(triple.object);
    }
  }
}

/**
 * Walk incoming edges (object ← subject) from `uri`, adding unseen nodes/edges.
 * Incoming nodes are shown as leaves (non-recursive).
 */
function walkIncoming(
  graph: CanonicalSchema,
  proj: TreeProjection,
  uri: string,
  nodeId: string,
  currentColumn: number,
  maxDepth: number,
  excludeSystem: boolean,
  nodes: PathNode[],
  edges: PathEdge[],
  maxBranching = 200,
): void {
  if (maxDepth <= 0) return;

  const triples = graph.incoming.get(uri) || [];
  const nextCol = currentColumn + 1;
  let count = 0;

  for (const triple of triples) {
    if (count >= maxBranching) break;
    if (triple.isRdfType) continue; // rdf:type incoming = class declarations, skip
    if (excludeSystem && isExcludedNode(triple.subject)) continue;
    if (proj.hasTriple(triple)) continue;

    // Reuse node if this URI already exists at nextCol (e.g. from outgoing walk),
    // otherwise create a fresh node.
    let sourceId = proj.getNodeIdAtColumn(triple.subject, nextCol);

    if (!sourceId) {
      const newNode = proj.makeNode(triple.subject, nextCol, false);
      proj.registerNode(newNode.id, triple.subject, nextCol);
      nodes.push(newNode);
      sourceId = newNode.id;
    }

    // Edge from anchor(nodeId) -> source(sourceId) with isIncoming flag
    edges.push(proj.makeEdge(nodeId, sourceId, triple, true));
    proj.registerTriple(triple);
    count++;
  }
}
