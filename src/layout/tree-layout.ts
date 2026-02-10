/**
 * Tree Layout
 * 
 * Computes positions for path tree nodes and generates edge paths.
 * Uses left-to-right tree layout matching Ruby style.
 */

import type { PathTree, PathNode, PathEdge, VisualModel } from '../types';
import { STYLE } from './styles';

export interface LayoutConfig {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  padding?: number;
  treeGap?: number;
}

/**
 * Layout multiple path trees vertically stacked.
 */
export function layoutTrees(trees: PathTree[], config: LayoutConfig = {}): VisualModel {
  const opts = {
    nodeWidth: config.nodeWidth ?? STYLE.nodeWidth,
    nodeHeight: config.nodeHeight ?? STYLE.nodeHeight,
    horizontalGap: config.horizontalGap ?? STYLE.horizontalGap,
    verticalGap: config.verticalGap ?? STYLE.verticalGap,
    padding: config.padding ?? STYLE.padding,
    treeGap: config.treeGap ?? STYLE.treeGap,
  };
  
  let currentY = opts.padding;
  let maxWidth = 0;
  
  for (const tree of trees) {
    layoutSingleTree(tree, opts, opts.padding, currentY);
    
    // Update max width
    maxWidth = Math.max(maxWidth, tree.bounds.x + tree.bounds.width);
    
    // Move Y for next tree
    currentY = tree.bounds.y + tree.bounds.height + opts.treeGap;
  }
  
  return {
    trees,
    totalBounds: {
      width: maxWidth + opts.padding,
      height: currentY - opts.treeGap + opts.padding,
    },
  };
}

/**
 * Layout a single tree starting at (startX, startY).
 *
 * RULES:
 * - Every edge exits the RIGHT-CENTER of the source node.
 * - Every edge arrives at the LEFT-CENTER of the target node.
 * - Edges are ORTHOGONAL: horizontal → vertical → horizontal (Z-shape).
 * - When a source has multiple outgoing edges, the vertical segment of each
 *   edge is staggered at a different X so they never overlap.
 * - Labels are placed on the last horizontal segment (near target), which is
 *   unique per edge, guaranteeing legibility.
 */
function layoutSingleTree(
  tree: PathTree,
  opts: Required<LayoutConfig>,
  startX: number,
  startY: number
): void {
  if (tree.nodes.length === 0) {
    tree.bounds = { x: startX, y: startY, width: 0, height: 0 };
    return;
  }

  // Ensure all nodes have valid column/row (default to 0 if NaN)
  for (const node of tree.nodes) {
    if (!Number.isFinite(node.column)) node.column = 0;
    if (!Number.isFinite(node.row)) node.row = 0;
  }

  // Group nodes by column
  const columns = new Map<number, PathNode[]>();
  for (const node of tree.nodes) {
    if (!columns.has(node.column)) columns.set(node.column, []);
    columns.get(node.column)!.push(node);
  }

  const sortedCols = [...columns.keys()].sort((a, b) => a - b);

  // Place nodes
  let maxX = startX;
  let maxY = startY;

  for (const colNum of sortedCols) {
    const colNodes = columns.get(colNum)!;
    const x = startX + colNum * (opts.nodeWidth + opts.horizontalGap);

    colNodes.sort((a, b) => a.row - b.row);

    colNodes.forEach((node, rowIndex) => {
      node.row = rowIndex;
      node.x = x;
      node.y = startY + rowIndex * (opts.nodeHeight + opts.verticalGap);
      node.width = opts.nodeWidth;
      node.height = opts.nodeHeight;

      // Ports: right-center out, left-center in
      node.outPort = { x: node.x + opts.nodeWidth, y: node.y + opts.nodeHeight / 2 };
      node.inPort  = { x: node.x,                  y: node.y + opts.nodeHeight / 2 };

      maxX = Math.max(maxX, node.x + opts.nodeWidth);
      maxY = Math.max(maxY, node.y + opts.nodeHeight);
    });
  }

  // ── Build orthogonal edge paths ───────────────────────────────────
  const nodeById = new Map(tree.nodes.map(n => [n.id, n]));

  // Group edges by source node so we can stagger vertical segments
  const edgesBySource = new Map<string, PathEdge[]>();
  for (const edge of tree.edges) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) continue;
    const leftId = source.column <= target.column ? edge.sourceId : edge.targetId;
    if (!edgesBySource.has(leftId)) edgesBySource.set(leftId, []);
    edgesBySource.get(leftId)!.push(edge);
  }

  for (const [sourceId, edges] of edgesBySource) {
    const sourceNode = nodeById.get(sourceId)!;

    // The gap between source right edge and target left edge
    const gap = opts.horizontalGap;
    // ALL vertical segments share the same X — midpoint of the gap.
    // They naturally separate on Y since each target is at a different row.
    const vertX = sourceNode.outPort.x + gap * 0.35;

    edges.forEach((edge) => {
      const target = nodeById.get(
        edge.sourceId === sourceId ? edge.targetId : edge.sourceId
      )!;
      const leftNode = sourceNode.column <= target.column ? sourceNode : target;
      const rightNode = sourceNode.column <= target.column ? target : sourceNode;

      const sx = leftNode.outPort.x;
      const sy = leftNode.outPort.y;
      const tx = rightNode.inPort.x;
      const ty = rightNode.inPort.y;

      if (Math.abs(sy - ty) < 1) {
        // Same row — straight horizontal line
        edge.path = `M ${sx} ${sy} H ${tx}`;
      } else {
        // Z-shape: H to shared vertX, V to target Y, H to target
        edge.path = `M ${sx} ${sy} H ${vertX} V ${ty} H ${tx}`;
      }
    });
  }

  tree.bounds = {
    x: startX,
    y: startY,
    width: maxX - startX,
    height: maxY - startY,
  };
}

/**
 * Compute bounding box for a set of nodes.
 */
export function computeBounds(nodes: PathNode[], padding = 0): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
