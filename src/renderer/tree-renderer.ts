/**
 * Tree Renderer
 * 
 * Renders path trees using D3.js with Ruby-style node visuals.
 * Each node has a header (type label) and value area (local name).
 */

import * as d3 from 'd3';
import type { PathTree, PathNode, PathEdge, VisualModel } from '../types';
import { STYLE, getNodeColors, getTypeIndicator, darkenColor } from '../layout/styles';
import type { DiagramState } from '../state/diagram-state';

export interface TreeRendererOptions {
  /** Container element */
  container: HTMLElement | SVGElement;
  
  /** Optional diagram state for highlighting */
  state?: DiagramState;

  /**
   * Schema-id -> { name, color } map - used for the legend.
   * Passed from SchemaDiagram when multiple datasets are loaded.
   */
  schemaColorMap?: Map<string, { name: string; color: string }>;
  
  /** Event callbacks */
  onNodeClick?: (node: PathNode, event?: MouseEvent) => void;
  onNodeHover?: (node: PathNode | null) => void;
  onEdgeClick?: (edge: PathEdge) => void;
}

/**
 * Tree Renderer class.
 */
export class TreeRenderer {
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private rootG!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private zoom!: d3.ZoomBehavior<SVGSVGElement, unknown>;
  
  private width = 0;
  private height = 0;
  private model: VisualModel | null = null;

  /** Schema color map - updated by SchemaDiagram on each render */
  private schemaColorMap: Map<string, { name: string; color: string }> = new Map();
  
  constructor(private options: TreeRendererOptions) {
    if (options.schemaColorMap) this.schemaColorMap = options.schemaColorMap;
    this.initSVG();
  }

  /** Update the schema color map (called when a new dataset combination is rendered). */
  setSchemaColorMap(map: Map<string, { name: string; color: string }> | undefined): void {
    this.schemaColorMap = map ?? new Map();
  }
  
  // ==========================================================================
  // Initialization
  // ==========================================================================
  
  private initSVG(): void {
    const container = this.options.container;
    
    // Clear existing content
    d3.select(container).selectAll('*').remove();
    
    // Create SVG
    this.svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .style('background', STYLE.diagramBg);
    
    // Get actual dimensions
    const rect = container.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 600;
    
    // Define arrow markers
    this.defineMarkers();
    
    // Create root group for zoom/pan
    this.rootG = this.svg.append('g')
      .attr('class', 'diagram-root');
    
    // Setup zoom behavior - wide range for large diagrams
    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.01, 10])
      .on('zoom', (event) => {
        this.rootG.attr('transform', event.transform);
      });
    
    this.svg.call(this.zoom);
  }
  
  /**
   * Define SVG markers for arrows.
   */
  private defineMarkers(): void {
    const defs = this.svg.append('defs');
    
    // Standard arrow marker (small, 5px) - points forward (->)
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 10)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 Z')
      .attr('fill', STYLE.strokeColor);
    
    // Reverse arrow marker - points backward (←), placed at START of path
    defs.append('marker')
      .attr('id', 'arrow-reverse')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 0)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 10 0 L 0 5 L 10 10 Z')
      .attr('fill', STYLE.strokeColor);
    
    // Arrow for rdf:type (dashed line)
    defs.append('marker')
      .attr('id', 'arrow-type')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 10)
      .attr('refY', 5)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 Z')
      .attr('fill', STYLE.strokeColor);
    
    // Highlighted arrows (one for each highlight color)
    (STYLE.highlightColors as string[]).forEach((color, i) => {
      defs.append('marker')
        .attr('id', `arrow-highlight-${i}`)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 10)
        .attr('refY', 5)
        .attr('markerWidth', 5)
        .attr('markerHeight', 5)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M 0 0 L 10 5 L 0 10 Z')
        .attr('fill', color);
    });
  }
  
  // ==========================================================================
  // Rendering
  // ==========================================================================
  
  /**
   * Render the visual model.
   */
  render(model: VisualModel): void {
    this.model = model;
    
    // Clear existing content
    this.rootG.selectAll('*').remove();
    
    if (model.trees.length === 0) {
      this.renderEmptyState();
      return;
    }
    
    // Render each tree
    for (const tree of model.trees) {
      this.renderTree(tree);
    }
    
    // Render the edge legend overlay (fixed in viewport, bottom-left)
    this.renderLegend();
    
    // Position at top-left with padding
    this.resetToOrigin();
  }
  
  /**
   * Render a single path tree.
   */
  private renderTree(tree: PathTree): void {
    const treeG = this.rootG.append('g')
      .attr('class', 'path-tree')
      .attr('data-tree-id', tree.id);
    
    // Render edge paths first (lines only, no labels)
    const edgesG = treeG.append('g').attr('class', 'edges');
    for (const edge of tree.edges) {
      this.renderEdgePath(edgesG, edge);
    }

    // Render edge labels - grouped by target node so overlapping labels stack
    this.renderEdgeLabels(edgesG, tree);
    
    // Render nodes
    const nodesG = treeG.append('g').attr('class', 'nodes');
    for (const node of tree.nodes) {
      this.renderNode(nodesG, node);
    }
  }
  
  /**
   * Render a node with Ruby-style two-part structure.
   */
  private renderNode(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: PathNode
  ): void {
    // Guard against invalid positions
    const x = Number.isFinite(node.x) ? node.x : 0;
    const y = Number.isFinite(node.y) ? node.y : 0;
    const width = Number.isFinite(node.width) ? node.width : STYLE.nodeWidth;
    const height = Number.isFinite(node.height) ? node.height : STYLE.nodeHeight;
    
    // Debug: log if any NaN values detected
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      console.warn('[TreeRenderer] Node with NaN position:', node.id, { 
        x: node.x, y: node.y, column: node.column, row: node.row,
        width: node.width, height: node.height
      });
    }
    
    const nodeG = container.append('g')
      .attr('class', 'node')
      .attr('data-node-id', node.id)
      .attr('transform', `translate(${x}, ${y})`)
      .style('cursor', 'pointer');
    
    // Get node styling
    const bgColor = this.getNodeColor(node);
    const isHighlighted = this.options.state?.getNodeHighlight(node.id);
    const iriColor = this.options.state?.getIriHighlight(node.uri);
    const hlColor = isHighlighted?.color ?? iriColor;
    
    // Main rectangle - rounded corners
    nodeG.append('rect')
      .attr('class', 'node-bg')
      .attr('width', width)
      .attr('height', height)
      .attr('rx', STYLE.nodeRadius)
      .attr('ry', STYLE.nodeRadius)
      .attr('fill', bgColor)
      .attr('stroke', hlColor ?? STYLE.strokeColor)
      .attr('stroke-width', hlColor ? STYLE.strokeWidth * 2 : STYLE.strokeWidth);
    
    // Header area (type label) - only if this is a typed node
    if (node.nodeType !== 'literal') {
      const headerColor = this.getHeaderColor(node);
      
      // Header background
      nodeG.append('rect')
        .attr('class', 'node-header-bg')
        .attr('width', width)
        .attr('height', STYLE.headerHeight)
        .attr('rx', STYLE.nodeRadius)
        .attr('ry', STYLE.nodeRadius)
        .attr('fill', headerColor)
        .attr('stroke', 'none');
      
      // Cover bottom corners of header
      nodeG.append('rect')
        .attr('class', 'node-header-cover')
        .attr('y', STYLE.headerHeight - STYLE.nodeRadius)
        .attr('width', width)
        .attr('height', STYLE.nodeRadius)
        .attr('fill', headerColor)
        .attr('stroke', 'none');
      
      // Header text (type label)
      const typeLabel = this.getTypeLabel(node);
      nodeG.append('text')
        .attr('class', 'node-header-text')
        .attr('x', width / 2)
        .attr('y', STYLE.headerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', STYLE.headerFontSize)
        .attr('font-weight', 'bold')
        .attr('fill', STYLE.textColor)
        .text(typeLabel);
      
      // Separator line
      nodeG.append('line')
        .attr('class', 'node-separator')
        .attr('x1', 0)
        .attr('y1', STYLE.headerHeight)
        .attr('x2', width)
        .attr('y2', STYLE.headerHeight)
        .attr('stroke', STYLE.strokeColor)
        .attr('stroke-width', 1);
    }
    
    // Value text (local name)
    const valueY = node.nodeType !== 'literal' 
      ? STYLE.headerHeight + (height - STYLE.headerHeight) / 2
      : height / 2;
    
    nodeG.append('text')
      .attr('class', 'node-value-text')
      .attr('x', width / 2)
      .attr('y', valueY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', STYLE.valueFontSize)
      .attr('fill', STYLE.textColor)
      .text(this.truncateLabel(node.label, width - 10));
    
    // Resolved-IRI instance badge (green dot with count)
    const resolvedIris = this.options.state?.getResolvedIris(node.uri);
    if (resolvedIris) {
      const badgeG = nodeG.append('g')
        .attr('class', 'iri-badge')
        .attr('transform', `translate(${width - 8}, 8)`);

      badgeG.append('circle')
        .attr('r', 10)
        .attr('fill', '#10b981')
        .attr('stroke', 'white')
        .attr('stroke-width', 2);

      badgeG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', '9px')
        .attr('font-weight', 'bold')
        .attr('fill', 'white')
        .text(resolvedIris.length > 9 ? '9+' : String(resolvedIris.length));

      // Tooltip on the badge listing the resolved IRIs
      const preview = resolvedIris.slice(0, 5).join('\n');
      const more = resolvedIris.length > 5 ? `\n… +${resolvedIris.length - 5} more` : '';
      badgeG.append('title')
        .text(`Resolved instances (${resolvedIris.length}):\n${preview}${more}`);
    }

    // Schema source dot - small colored circle in the bottom-right corner,
    // shown when the node belongs to a specific schema in a multi-schema view.
    if (node.schemaColor) {
      const DOT_R = 5;
      const dotG = nodeG.append('g')
        .attr('class', 'schema-dot')
        .attr('transform', `translate(${width - DOT_R - 3}, ${height - DOT_R - 3})`);

      dotG.append('circle')
        .attr('r', DOT_R)
        .attr('fill', node.schemaColor)
        .attr('stroke', 'white')
        .attr('stroke-width', 1.5);
    }

    // Event handlers
    nodeG
      .on('click', (event: MouseEvent) => {
        this.options.onNodeClick?.(node, event);
      })
      .on('mouseenter', () => {
        this.options.onNodeHover?.(node);
        nodeG.select('.node-bg')
          .attr('stroke', STYLE.hoverColor)
          .attr('stroke-width', STYLE.strokeWidth * 2);
      })
      .on('mouseleave', () => {
        this.options.onNodeHover?.(null);
        const hl = this.options.state?.getNodeHighlight(node.id);
        const iriC = this.options.state?.getIriHighlight(node.uri);
        const restoreColor = hl?.color ?? iriC;
        nodeG.select('.node-bg')
          .attr('stroke', restoreColor ?? STYLE.strokeColor)
          .attr('stroke-width', restoreColor ? STYLE.strokeWidth * 2 : STYLE.strokeWidth);
      });
  }
  
  /**
   * Render just the edge path (line + arrow), no label.
   */
  private renderEdgePath(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    edge: PathEdge
  ): void {
    const edgeG = container.append('g')
      .attr('class', 'edge')
      .attr('data-edge-id', edge.id);
    
    const isHighlighted = this.options.state?.getEdgeHighlight(edge.id);
    const strokeColor = isHighlighted ? isHighlighted.color : STYLE.strokeColor;
    const isIncoming = !!(edge as any).isIncoming;
    
    // All edges go left-to-right. Arrow is always at the end (right side).
    // Incoming edges get a dashed line to distinguish them.
    let markerEnd: string | null = null;
    
    if (isHighlighted) {
      const hlMarker = `url(#arrow-highlight-${STYLE.highlightColors.indexOf(isHighlighted.color) % STYLE.highlightColors.length})`;
      markerEnd = hlMarker;
    } else if (edge.isRdfType) {
      markerEnd = 'url(#arrow-type)';
    } else {
      markerEnd = 'url(#arrow)';
    }
    
    // Edge path
    if (!edge.path) {
      console.warn('Edge has no path:', edge);
      return;
    }
    
    const pathSelection = edgeG.append('path')
      .attr('class', 'edge-path')
      .attr('d', edge.path)
      .attr('fill', 'none')
      .attr('stroke', strokeColor)
      .attr('stroke-width', isHighlighted ? STYLE.strokeWidth * 1.5 : STYLE.strokeWidth)
      .attr('stroke-dasharray', isIncoming ? '4,3' : (edge.isRdfType ? '5,3' : null));
    
    if (markerEnd) pathSelection.attr('marker-end', markerEnd);
    
    // Event handlers
    edgeG
      .style('cursor', 'pointer')
      .on('click', () => {
        this.options.onEdgeClick?.(edge);
      });
  }

  /**
   * Render edge labels, grouped by target node.
   * When multiple edges arrive at the same target, their labels are stacked
   * vertically so they never overlap. Each label is prefixed with a direction
   * arrow: -> for outgoing, ← for incoming.
   */
  private renderEdgeLabels(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    tree: PathTree
  ): void {
    // Group edges by target node ID (the right-side node they point into)
    const edgesByTarget = new Map<string, PathEdge[]>();
    for (const edge of tree.edges) {
      const source = tree.nodes.find(n => n.id === edge.sourceId);
      const target = tree.nodes.find(n => n.id === edge.targetId);
      if (!source || !target) continue;
      // targetId is always the right-side node (higher column)
      const rightId = source.column <= target.column ? edge.targetId : edge.sourceId;
      if (!edgesByTarget.has(rightId)) edgesByTarget.set(rightId, []);
      edgesByTarget.get(rightId)!.push(edge);
    }

    const labelPadding = 3;
    const lineHeight = 14; // height per label row
    const COLLAPSE_THRESHOLD = 3; // show summary when > this many labels

    for (const [rightId, edges] of edgesByTarget) {
      // Sort: outgoing first (->), then incoming (←) for consistent ordering
      edges.sort((a, b) => {
        const aIn = (a as any).isIncoming ? 1 : 0;
        const bIn = (b as any).isIncoming ? 1 : 0;
        return aIn - bIn;
      });

      // Position labels at a fixed offset LEFT of the target (right-side) node's
      // inPort. This gives a consistent X for all edges arriving at the same
      // target, regardless of whether the edge is a straight H or a Z-shape.
      const rightNode = tree.nodes.find(n => n.id === rightId);
      if (!rightNode) continue;
      const labelOffset = STYLE.horizontalGap * 0.35; // midpoint of the gap
      const anchor = {
        x: rightNode.inPort.x - labelOffset,
        y: rightNode.inPort.y,
      };

      const totalLabels = edges.length;

      if (totalLabels > COLLAPSE_THRESHOLD) {
        // ── Collapsed mode: show "[N edges]" pill, click to expand ──
        this.renderCollapsedEdgeLabel(container, edges, anchor, labelPadding);
      } else {
        // ── Normal mode: show all labels stacked ──
        this.renderStackedEdgeLabels(container, edges, anchor, labelPadding, lineHeight);
      }
    }
  }

  /**
   * Render a collapsed "[N edges]" summary pill that expands on click.
   */
  private renderCollapsedEdgeLabel(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    edges: PathEdge[],
    anchor: { x: number; y: number },
    labelPadding: number,
  ): void {
    const lineHeight = 14;
    const totalLabels = edges.length;
    const summaryText = `[${totalLabels} edges]`;

    // Create a group for the collapsed state
    const group = container.append('g')
      .attr('class', 'edge-label-group collapsed')
      .style('cursor', 'pointer');

    // Measure summary text
    const tempText = container.append('text')
      .attr('font-size', STYLE.edgeFontSize)
      .text(summaryText);
    const textBox = tempText.node()?.getBBox();
    tempText.remove();

    if (!textBox || !Number.isFinite(textBox.width)) return;

    const labelY = anchor.y - 6;

    // Summary background pill
    group.append('rect')
      .attr('class', 'edge-label-bg')
      .attr('x', anchor.x - textBox.width / 2 - labelPadding - 2)
      .attr('y', labelY - textBox.height / 2 - labelPadding)
      .attr('width', textBox.width + (labelPadding + 2) * 2)
      .attr('height', textBox.height + labelPadding * 2)
      .attr('fill', '#e8eaed')
      .attr('rx', 8)
      .attr('ry', 8);

    // Summary text
    group.append('text')
      .attr('class', 'edge-label')
      .attr('x', anchor.x)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', STYLE.edgeFontSize)
      .attr('fill', '#555')
      .attr('font-weight', '600')
      .text(summaryText);

    // Pre-build the expanded labels group (hidden initially)
    const expandedGroup = container.append('g')
      .attr('class', 'edge-label-group expanded')
      .style('display', 'none')
      .style('cursor', 'pointer');

    // Render each label into the expanded group
    for (let i = 0; i < totalLabels; i++) {
      const edge = edges[i];
      const isIncoming = !!(edge as any).isIncoming;
      const arrow = isIncoming ? '\u2190 ' : '\u2192 ';
      const labelText = arrow + edge.label;

      const tmp = container.append('text')
        .attr('font-size', STYLE.edgeFontSize)
        .text(labelText);
      const tb = tmp.node()?.getBBox();
      tmp.remove();

      if (!tb || !Number.isFinite(tb.width)) continue;

      const stackOffset = (totalLabels - 1 - i) * lineHeight;
      const ly = anchor.y - 6 - stackOffset;

      expandedGroup.append('rect')
        .attr('class', 'edge-label-bg')
        .attr('x', anchor.x - tb.width / 2 - labelPadding)
        .attr('y', ly - tb.height / 2 - labelPadding)
        .attr('width', tb.width + labelPadding * 2)
        .attr('height', tb.height + labelPadding * 2)
        .attr('fill', STYLE.diagramBg)
        .attr('fill-opacity', 0.85)
        .attr('rx', 2)
        .attr('ry', 2);

      expandedGroup.append('text')
        .attr('class', 'edge-label')
        .attr('x', anchor.x)
        .attr('y', ly)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', STYLE.edgeFontSize)
        .attr('fill', STYLE.textColor)
        .attr('font-style', isIncoming ? 'italic' : 'normal')
        .text(labelText);
    }

    // Add a small "[collapse]" text at the top of the expanded stack
    const collapseY = anchor.y - 6 - (totalLabels) * lineHeight;
    expandedGroup.append('rect')
      .attr('x', anchor.x - 26)
      .attr('y', collapseY - 6)
      .attr('width', 52)
      .attr('height', 14)
      .attr('fill', '#e8eaed')
      .attr('rx', 7)
      .attr('ry', 7);
    expandedGroup.append('text')
      .attr('x', anchor.x)
      .attr('y', collapseY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 9)
      .attr('fill', '#555')
      .attr('font-weight', '600')
      .text('[collapse]');

    // Click handlers: toggle between collapsed and expanded
    group.on('click', (event: MouseEvent) => {
      event.stopPropagation();
      group.style('display', 'none');
      expandedGroup.style('display', null);
    });

    expandedGroup.on('click', (event: MouseEvent) => {
      event.stopPropagation();
      expandedGroup.style('display', 'none');
      group.style('display', null);
    });
  }

  /**
   * Render stacked edge labels (the normal case for ≤ COLLAPSE_THRESHOLD edges).
   */
  private renderStackedEdgeLabels(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    edges: PathEdge[],
    anchor: { x: number; y: number },
    labelPadding: number,
    lineHeight: number,
  ): void {
    const totalLabels = edges.length;

    for (let i = 0; i < totalLabels; i++) {
      const edge = edges[i];
      const isIncoming = !!(edge as any).isIncoming;
      const arrow = isIncoming ? '\u2190 ' : '\u2192 ';
      const labelText = arrow + edge.label;

      // Measure text
      const tempText = container.append('text')
        .attr('font-size', STYLE.edgeFontSize)
        .text(labelText);
      const textBox = tempText.node()?.getBBox();
      tempText.remove();

      if (!textBox || !Number.isFinite(textBox.width)) continue;

      // Stack from bottom (closest to line) to top
      const stackOffset = (totalLabels - 1 - i) * lineHeight;
      const labelY = anchor.y - 6 - stackOffset;

      container.append('rect')
        .attr('class', 'edge-label-bg')
        .attr('x', anchor.x - textBox.width / 2 - labelPadding)
        .attr('y', labelY - textBox.height / 2 - labelPadding)
        .attr('width', textBox.width + labelPadding * 2)
        .attr('height', textBox.height + labelPadding * 2)
        .attr('fill', STYLE.diagramBg)
        .attr('fill-opacity', 0)
        .attr('rx', 2)
        .attr('ry', 2);

      container.append('text')
        .attr('class', 'edge-label')
        .attr('x', anchor.x)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', STYLE.edgeFontSize)
        .attr('fill', STYLE.textColor)
        .attr('font-style', isIncoming ? 'italic' : 'normal')
        .text(labelText);
    }
  }

  
  /**
   * Render a legend overlay fixed to the bottom-left of the SVG viewport.
   * The legend sits *outside* the rootG zoom group so it doesn't move with pan/zoom.
   *
   * Shows:
   *  1. Edge type rows (Outgoing / Incoming)
   *  2. Schema color swatches (only when multiple schemas are loaded)
   */
  private renderLegend(): void {
    // Remove any existing legend
    this.svg.select('.diagram-legend').remove();

    const edgeItems: Array<{ label: string; dash: string | null; marker: string }> = [
      { label: 'Outgoing edge', dash: null,  marker: 'arrow' },
      { label: 'Incoming edge', dash: '4,3', marker: 'arrow' },
    ];

    const schemaEntries = [...this.schemaColorMap.values()];
    const hasSchemas = schemaEntries.length > 0;

    // Layout constants
    const lineX0  = 10;
    const lineLen  = 36;
    const lineY0   = 14;
    const lineH    = 16;
    const schemaStartY = lineY0 + edgeItems.length * lineH + (hasSchemas ? 8 : 0);
    const swatchR  = 5;
    const schemaH  = 14;

    const totalRows  = edgeItems.length + (hasSchemas ? schemaEntries.length + 1 : 0); // +1 for divider label
    const boxHeight  = lineY0 + edgeItems.length * lineH
                       + (hasSchemas ? 6 + 12 + schemaEntries.length * schemaH + 6 : 6);
    const boxWidth   = 185;

    const legendG = this.svg.append('g')
      .attr('class', 'diagram-legend')
      .attr('transform', `translate(12, ${this.height - boxHeight - 12})`);

    // Semi-transparent background
    legendG.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', boxWidth).attr('height', boxHeight)
      .attr('rx', 6).attr('ry', 6)
      .attr('fill', '#fff')
      .attr('fill-opacity', 0.88)
      .attr('stroke', '#d2d2d7')
      .attr('stroke-width', 1);

    // ── Edge type rows ──
    for (let i = 0; i < edgeItems.length; i++) {
      const { label, dash, marker } = edgeItems[i];
      const y = lineY0 + i * lineH;

      const pathEl = legendG.append('line')
        .attr('x1', lineX0)
        .attr('y1', y)
        .attr('x2', lineX0 + lineLen)
        .attr('y2', y)
        .attr('stroke', STYLE.strokeColor)
        .attr('stroke-width', STYLE.strokeWidth)
        .attr('marker-end', `url(#${marker})`);
      if (dash) pathEl.attr('stroke-dasharray', dash);

      legendG.append('text')
        .attr('x', lineX0 + lineLen + 10)
        .attr('y', y)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 10)
        .attr('fill', '#555')
        .text(label);
    }

    // ── Schema swatches (multi-dataset view) ──
    if (hasSchemas) {
      const dividerY = lineY0 + edgeItems.length * lineH + 4;

      // Thin separator line
      legendG.append('line')
        .attr('x1', 6).attr('y1', dividerY)
        .attr('x2', boxWidth - 6).attr('y2', dividerY)
        .attr('stroke', '#ddd').attr('stroke-width', 1);

      // "Schemas:" label
      legendG.append('text')
        .attr('x', lineX0)
        .attr('y', dividerY + 10)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', 9)
        .attr('font-weight', '600')
        .attr('fill', '#888')
        .text('Schemas:');

      for (let i = 0; i < schemaEntries.length; i++) {
        const { name, color } = schemaEntries[i];
        const y = dividerY + 10 + 12 + i * schemaH;

        // Colored dot
        legendG.append('circle')
          .attr('cx', lineX0 + swatchR)
          .attr('cy', y)
          .attr('r', swatchR)
          .attr('fill', color)
          .attr('stroke', 'white')
          .attr('stroke-width', 1);

        // Schema name (truncated)
        const maxChars = 22;
        const displayName = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
        legendG.append('text')
          .attr('x', lineX0 + swatchR * 2 + 6)
          .attr('y', y)
          .attr('dominant-baseline', 'middle')
          .attr('font-size', 10)
          .attr('fill', '#333')
          .text(displayName);
      }
    }
  }

  
  /**
   * Render empty state.
   */
  private renderEmptyState(): void {
    const cx = Number.isFinite(this.width) && this.width > 0 ? this.width / 2 : 400;
    const cy = Number.isFinite(this.height) && this.height > 0 ? this.height / 2 : 300;
    
    this.rootG.append('text')
      .attr('x', cx)
      .attr('y', cy)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 16)
      .attr('fill', '#999')
      .text('No schema data to display');
  }
  
  // ==========================================================================
  // View Control
  // ==========================================================================
  
  /**
   * Fit the diagram to view.
   */
  fitToView(padding = 40): void {
    if (!this.model || this.model.trees.length === 0) return;
    
    const bounds = this.model.totalBounds;
    
    // Guard against invalid bounds
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
        bounds.width <= 0 || bounds.height <= 0) {
      console.warn('[TreeRenderer] Invalid bounds, skipping fitToView:', bounds);
      return;
    }
    
    // Guard against invalid container dimensions
    if (!Number.isFinite(this.width) || !Number.isFinite(this.height) ||
        this.width <= 0 || this.height <= 0) {
      console.warn('[TreeRenderer] Invalid container dimensions:', this.width, this.height);
      return;
    }
    
    const availableWidth = this.width - padding * 2;
    const availableHeight = this.height - padding * 2;
    
    const scaleX = availableWidth / bounds.width;
    const scaleY = availableHeight / bounds.height;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
    
    // Guard against NaN scale
    if (!Number.isFinite(scale) || scale <= 0) {
      console.warn('[TreeRenderer] Invalid scale computed:', scale);
      return;
    }
    
    const translateX = (this.width - bounds.width * scale) / 2;
    const translateY = (this.height - bounds.height * scale) / 2;
    
    const transform = d3.zoomIdentity
      .translate(translateX, translateY)
      .scale(scale);
    
    this.svg.transition()
      .duration(300)
      .call(this.zoom.transform, transform);
  }
  
  /**
   * Reset zoom to 1:1.
   */
  resetZoom(): void {
    this.svg.transition()
      .duration(300)
      .call(this.zoom.transform, d3.zoomIdentity);
  }
  
  /**
   * Reset to origin (top-left) with padding.
   * This positions the diagram at the top-left corner with some margin.
   */
  resetToOrigin(): void {
    const padding = 20;
    const transform = d3.zoomIdentity.translate(padding, padding);
    
    this.svg.transition()
      .duration(300)
      .call(this.zoom.transform, transform);
  }
  
  /**
   * Zoom in by a factor of 1.3.
   */
  zoomIn(): void {
    this.svg.transition()
      .duration(200)
      .call(this.zoom.scaleBy, 1.3);
  }
  
  /**
   * Zoom out by a factor of 1.3.
   */
  zoomOut(): void {
    this.svg.transition()
      .duration(200)
      .call(this.zoom.scaleBy, 1 / 1.3);
  }
  
  /**
   * Zoom to a specific node.
   */
  zoomToNode(nodeId: string): void {
    const nodeEl = this.rootG.select(`[data-node-id="${nodeId}"]`);
    if (nodeEl.empty()) {
      console.warn('[TreeRenderer] zoomToNode: node not found in SVG:', nodeId);
      return;
    }

    const nodeGroup = nodeEl.node() as SVGGElement;
    
    // The node group has transform="translate(x, y)" - read the actual world position
    // by getting the bounding box relative to the rootG coordinate space.
    const bbox = nodeGroup.getBBox();
    
    // getBBox is in the local coordinate system of the group.
    // But the group itself sits inside a parent <g class="nodes"> which is inside <g class="path-tree">.
    // We need the cumulative transform from rootG down to this node group.
    // Use getCTM (current transform matrix) of the node relative to rootG's CTM.
    const rootCTM = (this.rootG.node() as SVGGElement).getCTM();
    const nodeCTM = nodeGroup.getCTM();
    
    if (!rootCTM || !nodeCTM) {
      console.warn('[TreeRenderer] zoomToNode: could not get CTM');
      return;
    }
    
    // The node's position in rootG coordinate space:
    // nodeCTM = screenCTM, rootCTM = screenCTM of rootG
    // We want the transform from rootG to node, so invert rootCTM and multiply with nodeCTM.
    const rootInverse = rootCTM.inverse();
    const localCTM = rootInverse.multiply(nodeCTM);
    
    // Transform the bbox center through localCTM
    const cx = localCTM.a * (bbox.x + bbox.width / 2) + localCTM.c * (bbox.y + bbox.height / 2) + localCTM.e;
    const cy = localCTM.b * (bbox.x + bbox.width / 2) + localCTM.d * (bbox.y + bbox.height / 2) + localCTM.f;

    const scale = 1;
    const x = -cx * scale + this.width / 2;
    const y = -cy * scale + this.height / 2;

    this.svg.transition()
      .duration(500)
      .call(this.zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
  }
  
  /**
   * Update container dimensions.
   */
  resize(): void {
    const rect = this.options.container.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 600;
    
    this.svg
      .attr('width', this.width)
      .attr('height', this.height);
    
    // Don't auto-fit on resize - keep user's current pan/zoom
  }
  
  // ==========================================================================
  // Update Methods
  // ==========================================================================
  
  /**
   * Update highlighting based on state.
   * Also applies focus/dimming when a path is focused.
   */
  updateHighlighting(): void {
    if (!this.options.state) return;
    const state = this.options.state;
    const hasFocus = state.isFocused();
    
    // Update node highlighting + dimming
    this.rootG.selectAll('.node').each((d, i, nodes) => {
      const nodeEl = d3.select(nodes[i]);
      const nodeId = nodeEl.attr('data-node-id');
      const highlight = state.getNodeHighlight(nodeId);
      const dimmed = hasFocus && state.isNodeDimmed(nodeId);
      
      nodeEl.select('.node-bg')
        .attr('stroke', highlight ? highlight.color : STYLE.strokeColor)
        .attr('stroke-width', highlight ? STYLE.strokeWidth * 2 : STYLE.strokeWidth);
      
      // Apply dimming
      if (dimmed) {
        nodeEl.style('opacity', '0.1');
      } else {
        (nodeEl as any).style('opacity', null);
      }
      
      // Bring highlighted nodes to front
      if (highlight && !dimmed) {
        (nodeEl.node() as SVGElement)?.parentElement?.appendChild(nodeEl.node() as SVGElement);
      }
    });
    
    // Update edge highlighting + dimming
    this.rootG.selectAll('.edge').each((d, i, nodes) => {
      const edgeEl = d3.select(nodes[i]);
      const edgeId = edgeEl.attr('data-edge-id');
      const highlight = state.getEdgeHighlight(edgeId);
      const dimmed = hasFocus && state.isEdgeDimmed(edgeId);
      
      if (highlight && !dimmed) {
        const colorIndex = STYLE.highlightColors.indexOf(highlight.color) % STYLE.highlightColors.length;
        edgeEl.select('.edge-path')
          .attr('stroke', highlight.color)
          .attr('stroke-width', STYLE.strokeWidth * 1.5)
          .attr('marker-end', `url(#arrow-highlight-${colorIndex})`);
        // Bring highlighted edges to front
        (edgeEl.node() as SVGElement)?.parentElement?.appendChild(edgeEl.node() as SVGElement);
      } else {
        edgeEl.select('.edge-path')
          .attr('stroke', STYLE.strokeColor)
          .attr('stroke-width', STYLE.strokeWidth)
          .attr('marker-end', 'url(#arrow)');
      }
      
      // Apply dimming
      if (dimmed) {
        edgeEl.style('opacity', '0.08');
      } else {
        (edgeEl as any).style('opacity', null);
      }
    });
    
    // Dim edge labels when focused
    if (hasFocus) {
      this.rootG.selectAll('.edge-label, .edge-label-bg').style('opacity', '0.08');
    } else {
      this.rootG.selectAll('.edge-label, .edge-label-bg').each(function() {
        (d3.select(this) as any).style('opacity', null);
      });
    }
  }
  
  // ==========================================================================
  // Helpers
  // ==========================================================================
  
  private getNodeColor(node: PathNode): string {
    return getNodeColors(node.nodeType || 'unknown').bg;
  }
  
  private getHeaderColor(node: PathNode): string {
    return getNodeColors(node.nodeType || 'unknown').header;
  }
  
  private getTypeLabel(node: PathNode): string {
    return getTypeIndicator(node.nodeType || '') || 'Node';
  }
  
  private darken(color: string, amount: number): string {
    return darkenColor(color, amount);
  }
  
  private truncateLabel(label: string, maxWidth: number): string {
    // Rough estimate: ~7px per character at 11px font
    const charWidth = 7;
    const maxChars = Math.floor(maxWidth / charWidth);
    
    if (label.length <= maxChars) return label;
    return label.slice(0, maxChars - 3) + '...';
  }
  
  /**
   * Destroy the renderer and clean up.
   */
  destroy(): void {
    this.svg.remove();
  }
}
