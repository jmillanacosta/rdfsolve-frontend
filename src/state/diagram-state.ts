/**
 * Diagram State - Enhanced
 * 
 * Centralized state management for the diagram component.
 * Handles:
 * - Node/edge selection
 * - Path drawing mode
 * - Multi-path highlighting with colors
 * - Expansion tracking
 * - Mode management (view, draw path, expand)
 */

import type { PathHighlight, DiagramStateSnapshot, DiagramEvent, DiagramEventHandler } from '../types';
import { STYLE } from '../layout/styles';

// =============================================================================
// Types
// =============================================================================

/** Interaction mode for the diagram */
export type DiagramMode = 
  | 'view'       // Default: click to select, hover to highlight
  | 'draw-path'  // Click nodes to draw path between them
  | 'expand'     // Click node to expand its connections
  | 'shapes';    // Click edge labels to select/deselect for shape definition

/** Path being drawn (in progress) — supports multi-node building */
export interface PathInProgress {
  startNodeId: string;
  startNodeUri: string;
  endNodeId?: string;
  endNodeUri?: string;
}

/** A node added during multi-node path building */
export interface PathBuildingNode {
  nodeId: string;
  nodeUri: string;
  label: string;
}

/** Multi-node path builder state */
export interface PathBuildingState {
  /** Nodes collected so far (ordered) */
  nodes: PathBuildingNode[];
  /** Whether building is active */
  active: boolean;
}

/** Expanded node tracking */
export interface ExpandedNode {
  nodeUri: string;
  direction: 'outgoing' | 'incoming' | 'both';
  treeId: string;
}

/** Enhanced path with more metadata */
export interface EnhancedPath extends PathHighlight {
  /** Start node URI */
  startUri: string;
  /** End node URI */
  endUri: string;
  /** Edges with full info (one per hop — the currently selected predicate) */
  edgeData?: Array<{
    source: string;
    target: string;
    predicate: string;
    isForward: boolean;
  }>;
  /**
   * Per-hop predicate alternatives.
   * edgeAlternatives[i] lists ALL predicates connecting the i-th hop's source
   * to its target. edgeData[i] is the currently selected one.
   * When length > 1, the SPARQL editor can render a dropdown selector.
   */
  edgeAlternatives?: Array<Array<{
    source: string;
    target: string;
    predicate: string;
    predicateLabel?: string;
    isForward: boolean;
  }>>;
}

// =============================================================================
// Diagram State Class
// =============================================================================

/**
 * DiagramState - Centralized state for the diagram.
 */
export class DiagramState {
  // Selection state
  private selectedRoots: Set<string> = new Set();
  private selectedNodeId: string | null = null;
  private hoveredNodeId: string | null = null;
  
  // Mode state
  private mode: DiagramMode = 'view';
  private pathInProgress: PathInProgress | null = null;
  private pathBuilding: PathBuildingState = { nodes: [], active: false };
  
  // Path state
  private paths: EnhancedPath[] = [];
  private nextColorIndex = 0;
  
  // Focus state
  private focusedPathIndex = -1;
  private focusedNodeIds: Set<string> = new Set();
  private focusedEdgeIds: Set<string> = new Set();
  
  // Expansion state
  private expandedNodes: Map<string, ExpandedNode> = new Map();
  
  // Computed highlight maps
  private highlightedNodes = new Map<string, { color: string; isStart: boolean; isEnd: boolean }>();
  private highlightedEdges = new Map<string, { color: string }>();

  // IRI-based highlights (URI → color).  These highlight nodes by their
  // semantic URI rather than visual node-id, so they survive re-renders.
  private iriHighlights = new Map<string, string>();

  // Resolved IRIs per class/node URI — classUri → list of concrete IRIs
  // that were resolved to this class.  Used by the renderer to draw
  // instance-count badges (green dots) on matched nodes.
  private resolvedIrisMap = new Map<string, string[]>();
  
  private listeners: DiagramEventHandler[] = [];
  
  constructor() {}
  
  // ==========================================================================
  // Event System
  // ==========================================================================
  
  /**
   * Subscribe to state changes.
   */
  subscribe(handler: DiagramEventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      const idx = this.listeners.indexOf(handler);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  
  private emit(event: DiagramEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }
  
  // ==========================================================================
  // Mode Management
  // ==========================================================================
  
  getMode(): DiagramMode {
    return this.mode;
  }
  
  setMode(mode: DiagramMode): void {
    const prev = this.mode;
    this.mode = mode;
    if (prev === 'draw-path' && mode !== 'draw-path') {
      this.pathInProgress = null;
    }
    this.emit({ type: 'selection-changed', selectedNodeId: this.selectedNodeId });
  }
  
  isDrawingPath(): boolean {
    return this.mode === 'draw-path';
  }
  
  hasPathInProgress(): boolean {
    return this.pathInProgress !== null;
  }
  
  getPathInProgress(): PathInProgress | null {
    return this.pathInProgress ? { ...this.pathInProgress } : null;
  }
  
  // ==========================================================================
  // Path Drawing
  // ==========================================================================
  
  startPath(nodeId: string, nodeUri: string): void {
    this.pathInProgress = { startNodeId: nodeId, startNodeUri: nodeUri };
    this.emit({ type: 'selection-changed', selectedNodeId: nodeId });
  }
  
  cancelPath(): void {
    this.pathInProgress = null;
    this.emit({ type: 'selection-changed', selectedNodeId: null });
  }
  
  completePath(nodeId: string, nodeUri: string): { startUri: string; endUri: string } | null {
    if (!this.pathInProgress) return null;
    const result = { startUri: this.pathInProgress.startNodeUri, endUri: nodeUri };
    this.pathInProgress = null;
    return result;
  }
  
  // ==========================================================================
  // Multi-Node Path Building
  // ==========================================================================
  
  /**
   * Start multi-node path building mode.
   */
  startPathBuilding(): void {
    this.pathBuilding = { nodes: [], active: true };
  }
  
  /**
   * Add a node to the path being built.
   * Allows the same URI twice in a row for reflexive/self-loop edges
   * (e.g. Protein → Protein via wp:bdbReactome).
   * Only blocks adding the exact same *visual* node ID consecutively.
   */
  addPathBuildingNode(nodeId: string, nodeUri: string, label: string): void {
    const last = this.pathBuilding.nodes[this.pathBuilding.nodes.length - 1];
    if (last && last.nodeId === nodeId) return; // same visual node click — ignore
    this.pathBuilding.nodes.push({ nodeId, nodeUri, label });
    this.emit({ type: 'selection-changed', selectedNodeId: nodeId });
  }
  
  /**
   * Undo the last node added to the path being built.
   */
  undoPathBuildingNode(): void {
    this.pathBuilding.nodes.pop();
    const last = this.pathBuilding.nodes[this.pathBuilding.nodes.length - 1];
    this.emit({ type: 'selection-changed', selectedNodeId: last?.nodeId ?? null });
  }
  
  /**
   * Cancel path building and discard nodes.
   */
  cancelPathBuilding(): void {
    this.pathBuilding = { nodes: [], active: false };
    this.emit({ type: 'selection-changed', selectedNodeId: null });
  }
  
  /**
   * Get the current path building state.
   */
  getPathBuildingState(): PathBuildingState {
    return { ...this.pathBuilding, nodes: [...this.pathBuilding.nodes] };
  }
  
  /**
   * Check if multi-node path building is active.
   */
  isPathBuildingActive(): boolean {
    return this.pathBuilding.active;
  }
  
  /**
   * Get the nodes collected so far for building.
   */
  getPathBuildingNodes(): PathBuildingNode[] {
    return [...this.pathBuilding.nodes];
  }
  
  // ==========================================================================
  // Focus / Isolation
  // ==========================================================================
  
  /**
   * Focus on a specific path, dimming all non-path elements.
   */
  setFocusedPath(index: number): void {
    if (index < 0 || index >= this.paths.length) {
      this.clearFocus();
      return;
    }
    this.focusedPathIndex = index;
    const path = this.paths[index];
    this.focusedNodeIds = new Set(path.nodeIds);
    this.focusedEdgeIds = new Set(path.edgeIds);
    
    // Also add edge keys from edgeData
    if (path.edgeData) {
      for (const e of path.edgeData) {
        this.focusedEdgeIds.add(`${e.source}_${e.target}`);
        this.focusedEdgeIds.add(`${e.target}_${e.source}`);
      }
    }
    
    this.emit({ type: 'paths-changed', paths: this.paths.slice() });
  }
  
  /**
   * Clear focus (show everything).
   */
  clearFocus(): void {
    this.focusedPathIndex = -1;
    this.focusedNodeIds.clear();
    this.focusedEdgeIds.clear();
    this.emit({ type: 'paths-changed', paths: this.paths.slice() });
  }
  
  /**
   * Get the focused path index (-1 if none).
   */
  getFocusedPathIndex(): number {
    return this.focusedPathIndex;
  }
  
  /**
   * Check if focus mode is active.
   */
  isFocused(): boolean {
    return this.focusedPathIndex >= 0;
  }
  
  /**
   * Check if a node should be dimmed (not in focused path).
   */
  isNodeDimmed(nodeId: string): boolean {
    if (!this.isFocused()) return false;
    return !this.focusedNodeIds.has(nodeId);
  }
  
  /**
   * Check if an edge should be dimmed.
   */
  isEdgeDimmed(edgeId: string): boolean {
    if (!this.isFocused()) return false;
    return !this.focusedEdgeIds.has(edgeId);
  }
  
  // ==========================================================================
  // Root Selection
  // ==========================================================================
  
  setSelectedRoots(rootUris: string[]): void {
    this.selectedRoots = new Set(rootUris);
    this.emit({ type: 'roots-changed', roots: rootUris });
  }
  
  getSelectedRoots(): string[] {
    return [...this.selectedRoots];
  }
  
  addRoot(rootUri: string): void {
    this.selectedRoots.add(rootUri);
    this.emit({ type: 'roots-changed', roots: [...this.selectedRoots] });
  }
  
  removeRoot(rootUri: string): void {
    this.selectedRoots.delete(rootUri);
    this.emit({ type: 'roots-changed', roots: [...this.selectedRoots] });
  }
  
  // ==========================================================================
  // Node Selection
  // ==========================================================================
  
  selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.emit({ type: 'selection-changed', selectedNodeId: nodeId });
  }
  
  getSelectedNode(): string | null {
    return this.selectedNodeId;
  }
  
  setHoveredNode(nodeId: string | null): void {
    this.hoveredNodeId = nodeId;
  }
  
  getHoveredNode(): string | null {
    return this.hoveredNodeId;
  }
  
  // ==========================================================================
  // Path Highlighting
  // ==========================================================================
  
  /**
   * Add a highlighted path.
   */
  addPath(
    nodeIds: string[], 
    edgeIds: string[] = [], 
    options?: { label?: string; startUri?: string; endUri?: string; edgeData?: EnhancedPath['edgeData']; edgeAlternatives?: EnhancedPath['edgeAlternatives'] }
  ): string {
    const colorIndex = this.nextColorIndex++;
    const pathId = `path_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    this.paths.push({
      id: pathId,
      nodeIds,
      edgeIds,
      colorIndex: colorIndex % STYLE.highlightColors.length,
      label: options?.label,
      startUri: options?.startUri || '',
      endUri: options?.endUri || '',
      edgeData: options?.edgeData,
      edgeAlternatives: options?.edgeAlternatives,
    });
    
    this.rebuildHighlightMaps();
    this.emit({ type: 'paths-changed', paths: this.paths.slice() });
    
    return pathId;
  }
  
  /**
   * Add multiple paths as a group (same color).
   */
  addPathGroup(
    pathsData: Array<{
      nodeIds: string[];
      edgeIds: string[];
      startUri?: string;
      endUri?: string;
      edgeData?: EnhancedPath['edgeData'];
    }>,
    groupLabel?: string
  ): string[] {
    const colorIndex = this.nextColorIndex++;
    const pathIds: string[] = [];
    
    for (let i = 0; i < pathsData.length; i++) {
      const data = pathsData[i];
      const pathId = `path_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
      
      this.paths.push({
        id: pathId,
        nodeIds: data.nodeIds,
        edgeIds: data.edgeIds,
        colorIndex: colorIndex % STYLE.highlightColors.length,
        label: groupLabel ? `${groupLabel} (${i + 1}/${pathsData.length})` : undefined,
        startUri: data.startUri || '',
        endUri: data.endUri || '',
        edgeData: data.edgeData,
      });
      
      pathIds.push(pathId);
    }
    
    this.rebuildHighlightMaps();
    this.emit({ type: 'paths-changed', paths: this.paths.slice() });
    
    return pathIds;
  }
  
  /**
   * Remove a path by index.
   */
  removePath(index: number): void {
    if (index >= 0 && index < this.paths.length) {
      this.paths.splice(index, 1);
      this.rebuildHighlightMaps();
      this.emit({ type: 'paths-changed', paths: this.paths.slice() });
    }
  }
  
  /**
   * Switch the selected predicate for a specific hop in a path.
   * @param pathIndex  index of the path in this.paths
   * @param hopIndex   index of the hop within edgeAlternatives / edgeData
   * @param altIndex   index of the alternative to select from edgeAlternatives[hopIndex]
   */
  selectEdgeAlternative(pathIndex: number, hopIndex: number, altIndex: number): void {
    const path = this.paths[pathIndex];
    if (!path?.edgeAlternatives?.[hopIndex]?.[altIndex]) return;
    const alt = path.edgeAlternatives[hopIndex][altIndex];
    if (path.edgeData) {
      path.edgeData[hopIndex] = {
        source: alt.source,
        target: alt.target,
        predicate: alt.predicate,
        isForward: alt.isForward,
      };
    }
    this.rebuildHighlightMaps();
    this.emit({ type: 'paths-changed', paths: this.paths.slice() });
  }
  
  /**
   * Remove a path by ID.
   */
  removePathById(pathId: string): void {
    const index = this.paths.findIndex(p => p.id === pathId);
    if (index >= 0) {
      this.removePath(index);
    }
  }
  
  /**
   * Clear all paths.
   */
  clearPaths(): void {
    this.paths = [];
    this.nextColorIndex = 0;
    this.focusedPathIndex = -1;
    this.focusedNodeIds.clear();
    this.focusedEdgeIds.clear();
    this.rebuildHighlightMaps();
    this.emit({ type: 'paths-changed', paths: [] });
  }
  
  /**
   * Get all paths.
   */
  getPaths(): EnhancedPath[] {
    return this.paths.slice();
  }
  
  /**
   * Get path count.
   */
  getPathCount(): number {
    return this.paths.length;
  }
  
  // ==========================================================================
  // Expansion Tracking
  // ==========================================================================
  
  addExpandedNode(nodeUri: string, direction: 'outgoing' | 'incoming' | 'both', treeId: string): void {
    this.expandedNodes.set(nodeUri, { nodeUri, direction, treeId });
  }
  
  removeExpandedNode(nodeUri: string): void {
    this.expandedNodes.delete(nodeUri);
  }
  
  isNodeExpanded(nodeUri: string): boolean {
    return this.expandedNodes.has(nodeUri);
  }
  
  getExpandedNode(nodeUri: string): ExpandedNode | undefined {
    return this.expandedNodes.get(nodeUri);
  }
  
  getAllExpandedNodes(): ExpandedNode[] {
    return [...this.expandedNodes.values()];
  }
  
  clearExpandedNodes(): void {
    this.expandedNodes.clear();
  }
  
  // ==========================================================================
  // IRI Highlights  (URI-based, survives re-renders)
  // ==========================================================================

  /**
   * Set highlighted IRIs (by semantic URI, not visual node-id).
   * @param uris  URIs to highlight
   * @param color  CSS colour (default: emerald green)
   */
  setIriHighlights(uris: string[], color = '#2ecc71'): void {
    this.iriHighlights.clear();
    for (const uri of uris) this.iriHighlights.set(uri, color);
    this.emit({ type: 'selection-changed', selectedNodeId: this.selectedNodeId });
  }

  /**
   * Check if a URI has an IRI-based highlight.
   */
  getIriHighlight(uri: string): string | null {
    return this.iriHighlights.get(uri) ?? null;
  }

  /**
   * Clear all IRI-based highlights.
   */
  clearIriHighlights(): void {
    if (this.iriHighlights.size === 0) return;
    this.iriHighlights.clear();
    this.emit({ type: 'selection-changed', selectedNodeId: this.selectedNodeId });
  }

  // ==========================================================================
  // Resolved IRIs  (class URI → concrete instance IRIs)
  // ==========================================================================

  /**
   * Store which concrete IRIs resolved to which class URIs.
   * The renderer draws a green badge with count on each matched node.
   */
  setResolvedIris(map: Map<string, string[]>): void {
    this.resolvedIrisMap = new Map(map);
  }

  /**
   * Get resolved IRIs for a given class/node URI.
   */
  getResolvedIris(uri: string): string[] | null {
    const list = this.resolvedIrisMap.get(uri);
    return list && list.length > 0 ? list : null;
  }

  /**
   * Clear resolved IRIs data.
   */
  clearResolvedIris(): void {
    this.resolvedIrisMap.clear();
  }
  
  // ==========================================================================
  // Highlight Queries
  // ==========================================================================
  
  /**
   * Check if a node is highlighted.
   */
  getNodeHighlight(nodeId: string): { color: string; isStart: boolean; isEnd: boolean } | null {
    return this.highlightedNodes.get(nodeId) || null;
  }
  
  /**
   * Check if an edge is highlighted.
   */
  getEdgeHighlight(edgeId: string): { color: string } | null {
    return this.highlightedEdges.get(edgeId) || null;
  }
  
  /**
   * Check edge highlight by endpoints.
   */
  getEdgeHighlightByEndpoints(source: string, target: string, predicate?: string): { color: string } | null {
    const keys = [`${source}_${target}`, `${source}_${target}_${predicate}`];
    for (const key of keys) {
      const h = this.highlightedEdges.get(key);
      if (h) return h;
    }
    return null;
  }
  
  /**
   * Check if there are any active highlights.
   */
  hasHighlights(): boolean {
    return this.paths.length > 0;
  }
  
  /**
   * Get all highlighted node IDs.
   */
  getHighlightedNodeIds(): string[] {
    return [...this.highlightedNodes.keys()];
  }
  
  /**
   * Get color for a color index.
   */
  getColor(colorIndex: number): string {
    return STYLE.highlightColors[colorIndex % STYLE.highlightColors.length];
  }
  
  // ==========================================================================
  // Snapshot
  // ==========================================================================
  
  /**
   * Get a snapshot of current state.
   */
  getSnapshot(): DiagramStateSnapshot {
    return {
      selectedRoots: [...this.selectedRoots],
      selectedNodeId: this.selectedNodeId,
      hoveredNodeId: this.hoveredNodeId,
      highlightedPaths: this.paths.slice(),
    };
  }
  
  // ==========================================================================
  // Internal
  // ==========================================================================
  
  private rebuildHighlightMaps(): void {
    this.highlightedNodes.clear();
    this.highlightedEdges.clear();
    
    for (const path of this.paths) {
      const color = this.getColor(path.colorIndex);
      
      path.nodeIds.forEach((nodeId, idx) => {
        const existing = this.highlightedNodes.get(nodeId);
        if (!existing) {
          this.highlightedNodes.set(nodeId, {
            color,
            isStart: idx === 0,
            isEnd: idx === path.nodeIds.length - 1,
          });
        }
      });
      
      for (const edgeId of path.edgeIds) {
        this.highlightedEdges.set(edgeId, { color });
      }
      
      // Index by source_target for lookup
      if (path.edgeData) {
        for (const edge of path.edgeData) {
          const key = `${edge.source}_${edge.target}`;
          this.highlightedEdges.set(key, { color });
          if (edge.predicate) {
            this.highlightedEdges.set(`${key}_${edge.predicate}`, { color });
          }
        }
      }
    }
  }

  // ==========================================================================
  // Shapes Mode — Edge Selection
  // ==========================================================================

  /** Edges selected for shape definition (edge ID → edge metadata). */
  private selectedShapeEdges = new Map<string, {
    edgeId: string;
    sourceUri: string;
    targetUri: string;
    predicate: string;
    predicateLabel: string;
  }>();

  /**
   * Toggle an edge's selection in shapes mode.
   * Returns `true` if the edge is now selected, `false` if deselected.
   */
  toggleShapeEdge(edge: {
    edgeId: string;
    sourceUri: string;
    targetUri: string;
    predicate: string;
    predicateLabel: string;
  }): boolean {
    if (this.selectedShapeEdges.has(edge.edgeId)) {
      this.selectedShapeEdges.delete(edge.edgeId);
      this.emit({ type: 'selection-changed', selectedNodeId: null });
      return false;
    }
    this.selectedShapeEdges.set(edge.edgeId, edge);
    this.emit({ type: 'selection-changed', selectedNodeId: null });
    return true;
  }

  /** Remove a specific shape edge by its ID. */
  removeShapeEdge(edgeId: string): void {
    this.selectedShapeEdges.delete(edgeId);
    this.emit({ type: 'selection-changed', selectedNodeId: null });
  }

  /** Get all currently selected shape edges. */
  getSelectedShapeEdges(): Array<{
    edgeId: string;
    sourceUri: string;
    targetUri: string;
    predicate: string;
    predicateLabel: string;
  }> {
    return [...this.selectedShapeEdges.values()];
  }

  /** Select all visible edges for shapes. */
  selectAllShapeEdges(edges: Array<{
    edgeId: string;
    sourceUri: string;
    targetUri: string;
    predicate: string;
    predicateLabel: string;
  }>): void {
    for (const e of edges) {
      this.selectedShapeEdges.set(e.edgeId, e);
    }
    this.emit({ type: 'selection-changed', selectedNodeId: null });
  }

  /** Clear all shape edge selections. */
  clearShapeEdges(): void {
    this.selectedShapeEdges.clear();
    this.emit({ type: 'selection-changed', selectedNodeId: null });
  }

  /** Check if an edge is selected in shapes mode. */
  isShapeEdgeSelected(edgeId: string): boolean {
    return this.selectedShapeEdges.has(edgeId);
  }
}
