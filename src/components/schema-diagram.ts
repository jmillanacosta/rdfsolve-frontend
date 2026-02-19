/**
 * Schema Diagram Web Component
 * 
 * A complete visualization component for RDF schemas.
 * Accepts JSON-LD input and renders path-centric tree diagrams.
 * 
 * Features:
 * - Path finding between nodes
 * - Node expansion (show incoming/outgoing edges)
 * - SPARQL query generation
 * - Multiple interaction modes
 */

import type { 
  JSONLDSchema, 
  CanonicalSchema, 
  PathTree, 
  VisualModel,
  PathNode,
  PathEdge,
} from '../types';
import { parseJSONLD } from '../parsers/jsonld-parser';
import {
  buildTrees as viewBuildTrees,
  expandTree,
  getNodeStats,
  getAvailableRoots as viewGetAvailableRoots,
  getNodeIdToUriMap,
  type ExpandResult,
} from '../data/view-builder';
import { layoutTrees } from '../layout/tree-layout';
import { TreeRenderer } from '../renderer/tree-renderer';
import { DiagramState, type DiagramMode, type EnhancedPath } from '../state/diagram-state';
import { IRIManager } from '../iri/iri-manager';
import { PathFinder, type EdgePath, type PathFinderOptions } from '../algorithms/path-finder';
import { composeFromPaths, type ComposeOptions, type ComposeResult } from '../sparql/compose-client';
import { 
  type DiagramStyle, 
  STYLE,
  setStyle, 
  getStyle, 
  updateStyle, 
  resetStyle,
  DEFAULT_STYLE,
  DARK_STYLE,
  HIGH_CONTRAST_STYLE,
  MINIMAL_STYLE,
} from '../layout/styles';

export interface SchemaDiagramOptions {
  /** Initial style (default: DEFAULT_STYLE) */
  style?: DiagramStyle;
  
  /** Initial root URIs to display (default: all subjects) */
  roots?: string[];
  
  /** Maximum depth for tree traversal */
  maxDepth?: number;
  
  /** Whether to show system nodes (owl, rdfs, etc.) */
  showSystemNodes?: boolean;

  /**
   * Subject URI → CSS color, built by DatasetSelector when multiple schemas
   * are merged so each node can show which schema it came from.
   */
  nodeColorMap?: Map<string, string>;

  /**
   * Schema-id → { name, color } — drives the legend swatches.
   */
  schemaColorMap?: Map<string, { name: string; color: string }>;
}

/**
 * Schema Diagram Web Component
 */
export class SchemaDiagram extends HTMLElement {
  private shadow: ShadowRoot;
  private container!: HTMLDivElement;
  private controlsContainer!: HTMLDivElement;
  private diagramContainer!: HTMLDivElement;
  
  private schema: CanonicalSchema | null = null;
  private trees: PathTree[] = [];
  private visualModel: VisualModel | null = null;
  
  private renderer: TreeRenderer | null = null;
  private state: DiagramState;
  private iriManager: IRIManager;
  private pathFinder: PathFinder | null = null;
  
  // Map nodeId -> URI for path/query generation
  private nodeIdToUri: Map<string, string> = new Map();
  
  private options: SchemaDiagramOptions = {};
  
  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.state = new DiagramState();
    this.iriManager = new IRIManager();
    this.setupDOM();
  }
  
  // ==========================================================================
  // Web Component Lifecycle
  // ==========================================================================
  
  connectedCallback(): void {
    this.render();
    
    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      this.renderer?.resize();
    });
    resizeObserver.observe(this.diagramContainer);
  }
  
  disconnectedCallback(): void {
    this.renderer?.destroy();
  }
  
  static get observedAttributes(): string[] {
    return ['src', 'roots', 'style-preset'];
  }
  
  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (oldValue === newValue) return;
    
    switch (name) {
      case 'src':
        if (newValue) this.loadFromURL(newValue);
        break;
      case 'roots':
        if (newValue) {
          const roots = newValue.split(',').map(r => r.trim());
          this.setRoots(roots);
        }
        break;
      case 'style-preset':
        this.applyStylePreset(newValue);
        break;
    }
  }
  
  // ==========================================================================
  // DOM Setup
  // ==========================================================================
  
  private setupDOM(): void {
    // Styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 400px;
      }
      
      .sd-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        font-family: system-ui, -apple-system, sans-serif;
        background: var(--sd-bg, #ffffff);
        border: 1px solid var(--sd-border, #e0e0e0);
        border-radius: 8px;
        overflow: hidden;
      }
      
      .sd-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        background: var(--sd-controls-bg, #f5f5f5);
        border-bottom: 1px solid var(--sd-border, #e0e0e0);
        flex-wrap: wrap;
      }
      
      .sd-controls label {
        font-size: 12px;
        color: var(--sd-text-secondary, #666);
      }
      
      .sd-controls select, .sd-controls input {
        padding: 4px 8px;
        font-size: 12px;
        border: 1px solid var(--sd-border, #ccc);
        border-radius: 4px;
        background: white;
      }
      
      .sd-controls button {
        padding: 4px 12px;
        font-size: 12px;
        border: 1px solid var(--sd-border, #ccc);
        border-radius: 4px;
        background: white;
        cursor: pointer;
      }
      
      .sd-controls button:hover {
        background: var(--sd-hover-bg, #e8e8e8);
      }
      
      .sd-controls button.active {
        background: var(--sd-active-bg, #007bff);
        color: white;
        border-color: var(--sd-active-bg, #007bff);
      }
      
      .sd-diagram {
        flex: 1;
        min-height: 300px;
        overflow: hidden;
        position: relative;
      }
      
      .sd-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--sd-text-secondary, #999);
        font-size: 14px;
      }
      
      .sd-root-wrap { position: relative; display: inline-block; }
      .sd-root-toggle {
        padding: 4px 8px; font-size: 12px; border: 1px solid var(--sd-border, #ccc);
        border-radius: 4px; background: white; cursor: pointer; min-width: 160px;
        text-align: left; display: flex; align-items: center; justify-content: space-between;
      }
      .sd-root-toggle .caret { font-size: 10px; margin-left: 6px; }
      .sd-root-dropdown {
        display: none; position: absolute; top: 100%; left: 0; z-index: 1100;
        background: #fff; border: 1px solid #d2d2d7; border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,.12); margin-top: 2px;
        min-width: 220px; max-width: 360px; max-height: 300px;
        flex-direction: column;
      }
      .sd-root-dropdown.open { display: flex; }
      .sd-root-search {
        padding: 6px 8px; border: none; border-bottom: 1px solid #eee;
        font-size: 12px; outline: none; width: 100%; box-sizing: border-box;
      }
      .sd-root-list { overflow-y: auto; flex: 1; padding: 4px 0; }
      .sd-root-item {
        display: flex; align-items: center; gap: 6px; padding: 4px 10px;
        font-size: 12px; cursor: pointer;
      }
      .sd-root-item:hover { background: #f0f4ff; }
      .sd-root-item input { margin: 0; }
      .sd-root-actions {
        display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid #eee;
        justify-content: space-between;
      }
      .sd-root-actions button { font-size: 11px; padding: 2px 8px; border: 1px solid #ccc;
        border-radius: 3px; background: #fff; cursor: pointer; }
      .sd-root-actions button:hover { background: #f0f0f2; }
      .sd-root-actions .apply-btn { background: #0066cc; color: #fff; border-color: #0066cc; }
      
      .sd-style-selector {
        max-width: 150px;
      }
    `;
    
    // Container
    this.container = document.createElement('div');
    this.container.className = 'sd-container';
    
    // Controls
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'sd-controls';
    this.controlsContainer.innerHTML = `
      <label>Root nodes:</label>
      <div class="sd-root-wrap">
        <button class="sd-root-toggle">All nodes <span class="caret">▾</span></button>
        <div class="sd-root-dropdown">
          <input class="sd-root-search" type="text" placeholder="Search roots…" autocomplete="off" />
          <div class="sd-root-list"></div>
          <div class="sd-root-actions">
            <button class="sd-root-all-btn">Select All</button>
            <button class="sd-root-none-btn">None</button>
            <button class="sd-root-apply-btn apply-btn">Apply</button>
          </div>
        </div>
      </div>
      
      <button class="sd-fit-btn" title="Fit diagram to view">Fit</button>
      <button class="sd-reset-btn" title="Reset zoom">Reset Zoom</button>
    `;
    
    // Diagram area
    this.diagramContainer = document.createElement('div');
    this.diagramContainer.className = 'sd-diagram';
    
    // Assemble
    this.container.appendChild(this.controlsContainer);
    this.container.appendChild(this.diagramContainer);
    this.shadow.appendChild(style);
    this.shadow.appendChild(this.container);
    
    // Event listeners
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    // Root selector dropdown
    const rootToggle = this.controlsContainer.querySelector('.sd-root-toggle') as HTMLButtonElement;
    const rootDropdown = this.controlsContainer.querySelector('.sd-root-dropdown') as HTMLElement;
    const rootSearch = this.controlsContainer.querySelector('.sd-root-search') as HTMLInputElement;
    
    rootToggle?.addEventListener('click', () => {
      rootDropdown.classList.toggle('open');
      if (rootDropdown.classList.contains('open')) {
        rootSearch.focus();
      }
    });
    
    // Close on outside click
    this.shadow.addEventListener('click', (e) => {
      const wrap = this.controlsContainer.querySelector('.sd-root-wrap');
      if (wrap && !wrap.contains(e.target as Node)) {
        rootDropdown?.classList.remove('open');
      }
    });
    
    // Search filter
    rootSearch?.addEventListener('input', () => {
      this.filterRootItems(rootSearch.value);
    });
    
    // Select all / none
    this.controlsContainer.querySelector('.sd-root-all-btn')?.addEventListener('click', () => {
      this.controlsContainer.querySelectorAll<HTMLInputElement>('.sd-root-list input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    this.controlsContainer.querySelector('.sd-root-none-btn')?.addEventListener('click', () => {
      this.controlsContainer.querySelectorAll<HTMLInputElement>('.sd-root-list input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    
    // Apply
    this.controlsContainer.querySelector('.sd-root-apply-btn')?.addEventListener('click', () => {
      const selected: string[] = [];
      this.controlsContainer.querySelectorAll<HTMLInputElement>('.sd-root-list input[type="checkbox"]:checked').forEach(cb => {
        selected.push(cb.value);
      });
      rootDropdown.classList.remove('open');
      const count = selected.length;
      const total = this.controlsContainer.querySelectorAll('.sd-root-list input[type="checkbox"]').length;
      rootToggle.innerHTML = count === total || count === 0
        ? 'All nodes <span class="caret">▾</span>'
        : `${count} of ${total} roots <span class="caret">▾</span>`;
      this.setRoots(selected.length > 0 && selected.length < total ? selected : undefined);
    });
    
    // Fit button
    const fitBtn = this.controlsContainer.querySelector('.sd-fit-btn');
    fitBtn?.addEventListener('click', () => this.fitToView());
    
    // Reset button
    const resetBtn = this.controlsContainer.querySelector('.sd-reset-btn');
    resetBtn?.addEventListener('click', () => this.resetZoom());
  }
  
  // ==========================================================================
  // Public API
  // ==========================================================================
  
  /**
   * Load schema data from JSON-LD object.
   */
  setData(jsonld: JSONLDSchema, options?: SchemaDiagramOptions): void {
    this.options = { ...this.options, ...options };
    
    // Apply style if provided
    if (options?.style) {
      setStyle(options.style);
    }
    
    // Parse to canonical schema
    this.schema = parseJSONLD(jsonld);

    // Copy color maps from caller into the schema so the view-builder
    // and renderer can access them without needing extra parameters
    if (options?.nodeColorMap)  this.schema.nodeColorMap  = options.nodeColorMap;
    if (options?.schemaColorMap) this.schema.schemaColorMap = options.schemaColorMap;
    
    // Register IRIs
    this.iriManager.registerFromSchema(this.schema);
    
    // Update root selector
    this.updateRootSelector();
    
    // Build and render
    this.rebuildAndRender(options?.roots);
  }
  
  /**
   * Load schema from URL.
   */
  async loadFromURL(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const jsonld = await response.json();
      this.setData(jsonld);
    } catch (error) {
      console.error('Failed to load schema:', error);
      this.showError(`Failed to load: ${error}`);
    }
  }
  
  /**
   * Set which root URIs to display.
   */
  setRoots(rootUris?: string[]): void {
    this.rebuildAndRender(rootUris);
  }
  
  /**
   * Get the current canonical schema.
   */
  getSchema(): CanonicalSchema | null {
    return this.schema;
  }
  
  /**
   * Get the current visual model.
   */
  getVisualModel(): VisualModel | null {
    return this.visualModel;
  }
  
  /**
   * Get the diagram state (for highlighting etc.)
   */
  getState(): DiagramState {
    return this.state;
  }
  
  /**
   * Get the IRI manager.
   */
  getIRIManager(): IRIManager {
    return this.iriManager;
  }
  
  /**
   * Update the diagram style.
   */
  setDiagramStyle(style: DiagramStyle): void {
    setStyle(style);
    this.rerender();
  }
  
  /**
   * Update partial style.
   */
  updateDiagramStyle(updates: Partial<DiagramStyle>): void {
    updateStyle(updates);
    this.rerender();
  }
  
  /**
   * Apply a preset style.
   */
  applyStylePreset(preset: string): void {
    switch (preset) {
      case 'dark':
        setStyle(DARK_STYLE);
        break;
      case 'high-contrast':
        setStyle(HIGH_CONTRAST_STYLE);
        break;
      case 'minimal':
        setStyle(MINIMAL_STYLE);
        break;
      default:
        setStyle(DEFAULT_STYLE);
    }
    this.rerender();
  }
  
  /**
   * Fit the diagram to view.
   */
  fitToView(): void {
    this.renderer?.fitToView();
  }
  
  /**
   * Reset zoom to 1:1.
   */
  resetZoom(): void {
    this.renderer?.resetZoom();
  }
  
  /**
   * Reset to origin (top-left).
   */
  resetToOrigin(): void {
    this.renderer?.resetToOrigin();
  }
  
  /**
   * Zoom to a specific node by its visual ID.
   */
  zoomToNode(nodeId: string): void {
    this.renderer?.zoomToNode(nodeId);
  }
  
  /**
   * Get a flat list of all nodes currently rendered, with URI and type info.
   * Useful for search/find features.
   */
  getNodeList(): Array<{ id: string; uri: string; label: string; nodeType: string }> {
    const nodes: Array<{ id: string; uri: string; label: string; nodeType: string }> = [];
    if (!this.trees) return nodes;
    for (const tree of this.trees) {
      for (const node of tree.nodes) {
        nodes.push({ id: node.id, uri: node.uri, label: node.label, nodeType: node.nodeType });
      }
    }
    return nodes;
  }

  /**
   * Get ALL nodes from the loaded schema (not just currently rendered ones).
   * Includes every subject URI in the canonical schema.
   * Useful for search/find across all loaded datasets.
   */
  getAllSchemaNodes(): Array<{ uri: string; label: string; nodeType: string }> {
    if (!this.schema) return [];
    const result: Array<{ uri: string; label: string; nodeType: string }> = [];
    for (const uri of this.schema.subjects) {
      const nodeType = this.schema.classUris.has(uri) ? 'class' : 'instance';
      result.push({ uri, label: this.iriManager.getLabel(uri), nodeType });
    }
    return result;
  }

  /**
   * Get the set of currently multi-selected node IDs.
   */
  getSelectedNodes(): string[] {
    return [...this.selectedNodes];
  }
  
  /**
   * Get the internal renderer (for advanced usage).
   */
  getRenderer(): TreeRenderer | null {
    return this.renderer;
  }
  
  /**
   * Zoom in.
   */
  zoomIn(): void {
    this.renderer?.zoomIn();
  }
  
  /**
   * Zoom out.
   */
  zoomOut(): void {
    this.renderer?.zoomOut();
  }
  
  // ==========================================================================
  // Mode Management
  // ==========================================================================
  
  /**
   * Set interaction mode.
   */
  setMode(mode: DiagramMode): void {
    this.state.setMode(mode);
    this.dispatchEvent(new CustomEvent('mode-change', { detail: { mode } }));
  }
  
  /**
   * Get current interaction mode.
   */
  getMode(): DiagramMode {
    return this.state.getMode();
  }
  
  /**
   * Enter path drawing mode.
   */
  enterPathDrawingMode(): void {
    this.setMode('draw-path');
  }
  
  /**
   * Enter expand mode.
   */
  enterExpandMode(): void {
    this.setMode('expand');
  }
  
  /**
   * Exit to view mode.
   */
  exitToViewMode(): void {
    this.setMode('view');
  }

  /**
   * Exit path drawing mode (alias for exitToViewMode).
   */
  exitPathDrawingMode(): void {
    this.exitToViewMode();
  }

  /**
   * Set click mode directly.
   */
  setClickMode(mode: 'normal' | 'path-drawing' | 'expand'): void {
    switch (mode) {
      case 'path-drawing':
        this.setMode('draw-path');
        break;
      case 'expand':
        this.setMode('expand');
        break;
      default:
        this.setMode('view');
    }
  }

  /**
   * Stored expand direction for expand mode.
   */
  private expandDirection: 'outgoing' | 'incoming' | 'both' = 'outgoing';

  /**
   * Set expansion direction for expand mode clicks.
   */
  setExpandDirection(direction: 'outgoing' | 'incoming' | 'both'): void {
    this.expandDirection = direction;
  }

  /**
   * Get current expansion direction.
   */
  getExpandDirection(): 'outgoing' | 'incoming' | 'both' {
    return this.expandDirection;
  }

  /**
   * Remove a specific path by index.
   */
  removePath(index: number): void {
    const paths = this.state.getPaths();
    if (index >= 0 && index < paths.length) {
      this.state.removePath(index);
      // Emit paths-changed event
      this.dispatchEvent(new CustomEvent('paths-changed', { 
        detail: { paths: this.state.getPaths().map(p => p.nodeIds) } 
      }));
      // Re-render to apply highlight changes
      if (this.visualModel && this.renderer) {
        this.renderer.render(this.visualModel);
      }
    }
  }
  
  // ==========================================================================
  // Path Finding
  // ==========================================================================
  
  /**
   * Get the PathFinder instance (creates one if needed).
   */
  getPathFinder(): PathFinder | null {
    if (!this.schema) return null;
    if (!this.pathFinder) {
      this.pathFinder = new PathFinder(this.schema);
    }
    return this.pathFinder;
  }
  
  /**
   * Find shortest path between two URIs.
   */
  findShortestPath(startUri: string, endUri: string, options?: PathFinderOptions): EdgePath | null {
    const finder = this.getPathFinder();
    if (!finder) return null;
    return finder.findShortestPath(startUri, endUri, options);
  }
  
  /**
   * Find all paths between two URIs.
   */
  findAllPaths(startUri: string, endUri: string, options?: PathFinderOptions): EdgePath[] {
    const finder = this.getPathFinder();
    if (!finder) return [];
    return finder.findAllPaths(startUri, endUri, options);
  }
  
  /**
   * Add a path to highlight from EdgePath result.
   * Maps EdgePath URIs back to actual visual node/edge IDs for SVG highlighting.
   * 
   * @param edgePath       The path (nodes + selected edges)
   * @param label          Display label
   * @param edgeAlternatives  Per-hop list of ALL predicate options (for dropdown selectors)
   */
  addPathFromEdgePath(
    edgePath: EdgePath,
    label?: string,
    edgeAlternatives?: Array<Array<import('../algorithms/path-finder').PathEdgeInfo>>,
  ): string {
    // Build reverse map: URI → visual node IDs (a URI may appear multiple times)
    const uriToNodeIds = new Map<string, string[]>();
    if (this.trees) {
      for (const tree of this.trees) {
        for (const node of tree.nodes) {
          if (!uriToNodeIds.has(node.uri)) uriToNodeIds.set(node.uri, []);
          uriToNodeIds.get(node.uri)!.push(node.id);
        }
      }
    }

    // Map each URI in the EdgePath to the first matching visual node ID
    const nodeIds = edgePath.nodes.map(uri => {
      const ids = uriToNodeIds.get(uri);
      return ids ? ids[0] : `unknown_${uri.replace(/[^a-zA-Z0-9]/g, '_')}`;
    });

    // Build edge IDs that match the SVG data-edge-id format: "edge_{sourceNodeId}_{targetNodeId}"
    const edgeIds: string[] = [];
    for (const e of edgePath.edges) {
      const srcIds = uriToNodeIds.get(e.source) || [];
      const tgtIds = uriToNodeIds.get(e.target) || [];
      // Try to find a matching edge ID in the visual model
      let matched = false;
      if (this.trees) {
        for (const tree of this.trees) {
          for (const edge of tree.edges) {
            const srcNode = tree.nodes.find(n => n.id === edge.sourceId);
            const tgtNode = tree.nodes.find(n => n.id === edge.targetId);
            if (srcNode && tgtNode && 
                ((srcNode.uri === e.source && tgtNode.uri === e.target) ||
                 (srcNode.uri === e.target && tgtNode.uri === e.source)) &&
                edge.predicate === e.predicate) {
              edgeIds.push(edge.id);
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
      }
      if (!matched) {
        // Fallback: construct from first matching node IDs
        const srcId = srcIds[0] || `unknown_src`;
        const tgtId = tgtIds[0] || `unknown_tgt`;
        edgeIds.push(`edge_${srcId}_${tgtId}`);
      }
    }

    const pathId = this.state.addPath(nodeIds, edgeIds, {
      label,
      startUri: edgePath.nodes[0],
      endUri: edgePath.nodes[edgePath.nodes.length - 1],
      edgeData: edgePath.edges.map(e => ({
        source: e.source,
        target: e.target,
        predicate: e.predicate,
        isForward: e.isForward,
      })),
      edgeAlternatives: edgeAlternatives?.map(alts => alts.map(e => ({
        source: e.source,
        target: e.target,
        predicate: e.predicate,
        predicateLabel: e.predicateLabel,
        isForward: e.isForward,
      }))),
    });

    // Re-render to show highlighting
    if (this.visualModel && this.renderer) {
      this.renderer.updateHighlighting();
    }

    // Dispatch paths-changed event
    this.dispatchEvent(new CustomEvent('paths-changed', {
      detail: { paths: this.state.getPaths().map(p => p.nodeIds) }
    }));

    return pathId;
  }
  
  /**
   * Clear all highlighted paths.
   */
  clearPaths(): void {
    this.state.clearPaths();
    // Re-render to apply highlight changes
    if (this.visualModel && this.renderer) {
      this.renderer.render(this.visualModel);
    }
  }
  
  /**
   * Get all highlighted paths.
   */
  getPaths(): EnhancedPath[] {
    return this.state.getPaths();
  }
  
  // ==========================================================================
  // Node Expansion
  // ==========================================================================
  
  /**
   * Expand a node to show its connections.
   * Finds the tree containing the node and adds unseen connections from the graph.
   */
  expandNode(nodeUri: string, options?: { direction?: 'outgoing' | 'incoming' | 'both'; maxNodes?: number; nodeId?: string }): ExpandResult | null {
    if (!this.schema || this.trees.length === 0) return null;

    // Find the tree containing this node
    let targetTree: PathTree | undefined;
    for (const tree of this.trees) {
      if (tree.nodes.some(n => n.uri === nodeUri)) {
        targetTree = tree;
        break;
      }
    }
    if (!targetTree) return null;

    const result = expandTree(this.schema, targetTree, nodeUri, {
      direction: options?.direction ?? 'both',
      maxDepth: options?.maxNodes ?? 1,
      maxBranching: 50,
      nodeId: options?.nodeId,
    });

    if (result && result.nodesAdded + result.edgesAdded > 0) {
      // Update nodeId→URI map
      this.nodeIdToUri = getNodeIdToUriMap(this.trees);

      // Track expansion in state
      this.state.addExpandedNode(nodeUri, options?.direction || 'both', 'view');

      // Re-layout and render
      this.visualModel = layoutTrees(this.trees);
      this.render();
    }

    return result;
  }
  
  /**
   * Get expansion statistics for a node.
   * Reports total connections AND unseen connections in the graph.
   */
  getExpansionStats(nodeUri: string): {
    outgoing: number; incoming: number;
    unseenOutgoing: number; unseenIncoming: number;
    total: number;
  } | null {
    if (!this.schema || this.trees.length === 0) return null;

    for (const tree of this.trees) {
      if (tree.nodes.some(n => n.uri === nodeUri)) {
        return getNodeStats(this.schema, tree, nodeUri);
      }
    }
    return null;
  }
  
  // ==========================================================================
  // SPARQL Query Generation
  // ==========================================================================
  
  /**
   * Generate SPARQL query from current highlighted paths via the backend API.
   * All composition logic lives in the `rdfsolve.compose` Python module.
   */
  async generateSPARQL(options?: {
    includeTypes?: boolean;
    includeLabels?: boolean;
    limit?: number;
    valueBindings?: Map<string, string[]>;
  }): Promise<ComposeResult> {
    const paths = this.state.getPaths();
    if (paths.length === 0) {
      return {
        query: '# No paths selected. Draw paths in the diagram first.',
        variable_map: {},
        jsonld: {},
      };
    }
    
    // Collect prefixes from schema (if loaded)
    const prefixes: Record<string, string> = this.schema?.prefixes
      ? { ...this.schema.prefixes }
      : {};
    
    // Map frontend options → backend API options
    const composeOpts: ComposeOptions = {
      include_types: options?.includeTypes ?? false,
      include_labels: options?.includeLabels ?? true,
      limit: options?.limit ?? 100,
    };
    
    // Convert valueBindings Map → plain object
    if (options?.valueBindings && options.valueBindings.size > 0) {
      const bindings: Record<string, string[]> = {};
      for (const [k, v] of options.valueBindings) {
        bindings[k] = v;
      }
      composeOpts.value_bindings = bindings;
    }
    
    return composeFromPaths(paths, prefixes, composeOpts);
  }
  
  // ==========================================================================
  // Available Roots
  // ==========================================================================
  
  /**
   * Get available root nodes (sorted by connectivity).
   */
  getAvailableRoots(): Array<{ uri: string; label: string; outDegree: number }> {
    if (!this.schema) return [];
    return viewGetAvailableRoots(this.schema);
  }
  
  // ==========================================================================
  // Internal Methods
  // ==========================================================================
  
  private updateRootSelector(): void {
    const list = this.controlsContainer.querySelector('.sd-root-list') as HTMLElement;
    if (!list || !this.schema) return;

    list.innerHTML = '';

    for (const subject of this.schema.subjects) {
      const label = document.createElement('label');
      label.className = 'sd-root-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = subject;

      const span = document.createElement('span');
      span.textContent = this.iriManager.getLabel(subject);
      span.title = subject;

      label.appendChild(cb);
      label.appendChild(span);
      list.appendChild(label);
    }
  }

  private filterRootItems(query: string): void {
    const list = this.controlsContainer.querySelector('.sd-root-list') as HTMLElement;
    if (!list) return;
    const lowerQuery = query.toLowerCase();
    const items = list.querySelectorAll('.sd-root-item') as NodeListOf<HTMLElement>;
    for (const item of items) {
      const span = item.querySelector('span');
      const text = (span?.textContent ?? '').toLowerCase();
      const value = (item.querySelector('input') as HTMLInputElement)?.value.toLowerCase() ?? '';
      item.style.display = (text.includes(lowerQuery) || value.includes(lowerQuery)) ? '' : 'none';
    }
  }
  
  private rebuildAndRender(rootUris?: string[]): void {
    if (!this.schema) return;
    
    // Determine roots
    const roots = rootUris && rootUris.length > 0 
      ? rootUris 
      : [...this.schema.subjects];
    
    // Store selected roots in state
    this.state.setSelectedRoots(roots);
    
    // Rebuild PathFinder when schema changes
    this.pathFinder = new PathFinder(this.schema);

    const md = this.options.maxDepth ?? 1;
    
    // Build trees using pure functions
    this.trees = viewBuildTrees(this.schema, roots, {
      maxDepth: md,
      excludeSystemNodes: !this.options.showSystemNodes,
    });
    
    // Get nodeId -> URI map from trees
    this.nodeIdToUri = getNodeIdToUriMap(this.trees);
    
    // Layout trees
    this.visualModel = layoutTrees(this.trees);
    
    // Render
    this.render();
  }
  
  private render(): void {
    if (!this.visualModel || this.visualModel.trees.length === 0) {
      this.diagramContainer.innerHTML = '<div class="sd-empty">No data to display. Load a schema or select root nodes.</div>';
      return;
    }
    
    // Create or update renderer
    if (!this.renderer) {
      this.renderer = new TreeRenderer({
        container: this.diagramContainer,
        state: this.state,
        schemaColorMap: this.schema?.schemaColorMap,
        onNodeClick: (node, event) => this.handleNodeClick(node, event),
        onNodeHover: (node) => this.handleNodeHover(node),
        onEdgeClick: (edge) => this.handleEdgeClick(edge),
      });
    } else {
      // Update schemaColorMap on existing renderer (datasets may have changed)
      this.renderer.setSchemaColorMap(this.schema?.schemaColorMap);
    }
    
    this.renderer.render(this.visualModel);
  }
  
  private rerender(): void {
    if (this.visualModel && this.renderer) {
      // Recreate renderer with new styles
      this.renderer.destroy();
      this.renderer = new TreeRenderer({
        container: this.diagramContainer,
        state: this.state,
        schemaColorMap: this.schema?.schemaColorMap,
        onNodeClick: (node, event) => this.handleNodeClick(node, event),
        onNodeHover: (node) => this.handleNodeHover(node),
        onEdgeClick: (edge) => this.handleEdgeClick(edge),
      });
      this.renderer.render(this.visualModel);
    }
  }
  
  private showError(message: string): void {
    this.diagramContainer.innerHTML = `<div class="sd-empty" style="color: #c00;">${message}</div>`;
  }
  
  // Track selected node set for multi-selection
  private selectedNodes: Set<string> = new Set();

  private handleNodeClick(node: PathNode, event?: MouseEvent): void {
    const mode = this.state.getMode();
    const isCtrl = event?.ctrlKey || event?.metaKey || false;
    const isShift = event?.shiftKey || false;
    
    if (mode === 'draw-path') {
      // Multi-node path building — just fire node-click so path-list can pick it up.
      // If PathBuildingState is active, path-list handles adding the node.
      // Also visually highlight the node as "selected for path".
      this.highlightPathStartNode(node.id, true);
      // The event dispatch at the bottom of this method handles everything.
    } else if (mode === 'expand') {
      // Expansion mode
      this.dispatchEvent(new CustomEvent('expand-request', { detail: { node } }));
    } else {
      // Default view mode — support multi-select with Ctrl/Shift
      if (isCtrl || isShift) {
        if (this.selectedNodes.has(node.id)) {
          this.selectedNodes.delete(node.id);
        } else {
          this.selectedNodes.add(node.id);
        }
        this.state.selectNode(this.selectedNodes.size > 0 ? [...this.selectedNodes].pop()! : null);
      } else {
        this.selectedNodes.clear();
        this.selectedNodes.add(node.id);
        this.state.selectNode(node.id);
      }
    }
    
    this.dispatchEvent(new CustomEvent('node-click', { detail: node }));
  }
  
  private handleNodeHover(node: PathNode | null): void {
    this.state.setHoveredNode(node?.id ?? null);
    this.dispatchEvent(new CustomEvent('node-hover', { detail: node }));
  }
  
  private handleEdgeClick(edge: PathEdge): void {
    const mode = this.state.getMode();

    if (mode === 'shapes') {
      // In shapes mode, dispatch edge info so the shapes panel can
      // handle deletion.  We don't toggle internal state here —
      // the panel owns the working-set logic.
      const sourceNode = this.trees
        .flatMap(t => t.nodes)
        .find(n => n.id === edge.sourceId);
      const targetNode = this.trees
        .flatMap(t => t.nodes)
        .find(n => n.id === edge.targetId);

      if (sourceNode && targetNode) {
        this.dispatchEvent(new CustomEvent('shape-edge-toggle', {
          detail: {
            edgeId: edge.id,
            sourceUri: sourceNode.uri,
            targetUri: targetNode.uri,
            predicate: edge.predicate,
            predicateLabel: edge.label,
          },
        }));
      }
    }

    this.dispatchEvent(new CustomEvent('edge-click', { detail: edge }));
  }

  /**
   * Enter shapes editing mode.
   */
  enterShapesMode(): void {
    this.setMode('shapes');
  }

  /**
   * Get all edges in the current visual model (for "Select All").
   */
  getAllVisibleEdges(): Array<{
    edgeId: string;
    sourceUri: string;
    targetUri: string;
    predicate: string;
    predicateLabel: string;
  }> {
    if (!this.trees) return [];
    const result: Array<{
      edgeId: string; sourceUri: string; targetUri: string;
      predicate: string; predicateLabel: string;
    }> = [];

    for (const tree of this.trees) {
      for (const edge of tree.edges) {
        const src = tree.nodes.find(n => n.id === edge.sourceId);
        const tgt = tree.nodes.find(n => n.id === edge.targetId);
        if (src && tgt) {
          result.push({
            edgeId: edge.id,
            sourceUri: src.uri,
            targetUri: tgt.uri,
            predicate: edge.predicate,
            predicateLabel: edge.label,
          });
        }
      }
    }
    return result;
  }

  /**
   * Highlight (or un-highlight) a node as the "path-start" so the user
   * can immediately see which node they clicked.
   */
  private highlightPathStartNode(nodeId: string, on: boolean): void {
    if (!this.renderer) return;
    const svg = this.diagramContainer.querySelector('svg');
    if (!svg) return;
    const nodeEl = svg.querySelector(`[data-node-id="${nodeId}"]`);
    if (!nodeEl) return;

    const bg = nodeEl.querySelector('.node-bg') as SVGRectElement | null;
    if (!bg) return;

    if (on) {
      bg.setAttribute('stroke', '#ff6600');
      bg.setAttribute('stroke-width', '3');
      bg.setAttribute('stroke-dasharray', '6,3');
      // Add a pulsing animation
      const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      anim.setAttribute('attributeName', 'stroke-opacity');
      anim.setAttribute('values', '1;0.3;1');
      anim.setAttribute('dur', '1.2s');
      anim.setAttribute('repeatCount', 'indefinite');
      anim.classList.add('path-start-pulse');
      bg.appendChild(anim);
    } else {
      bg.setAttribute('stroke', STYLE.strokeColor);
      bg.setAttribute('stroke-width', String(STYLE.strokeWidth));
      bg.removeAttribute('stroke-dasharray');
      bg.querySelector('.path-start-pulse')?.remove();
    }
  }
}

// Register custom element
customElements.define('schema-diagram', SchemaDiagram);

// Export for module usage
export { SchemaDiagram as default };
