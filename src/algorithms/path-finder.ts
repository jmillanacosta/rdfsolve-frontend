/**
 * Path Finder
 * 
 * Graph traversal algorithms for finding paths between nodes.
 * All algorithms work on the canonical schema's adjacency data.
 */

import type { CanonicalSchema, CanonicalTriple } from '../types';

// =============================================================================
// Types
// =============================================================================

/** A path through the graph as node URIs */
export interface NodePath {
  /** Ordered node URIs from start to end */
  nodes: string[];
  /** Total length (number of edges) */
  length: number;
}

/** A path with edge information */
export interface EdgePath {
  /** Ordered node URIs */
  nodes: string[];
  /** Edges between consecutive nodes */
  edges: PathEdgeInfo[];
  /** Total length */
  length: number;
}

/** Edge info within a path */
export interface PathEdgeInfo {
  source: string;
  target: string;
  predicate: string;
  predicateLabel?: string;
  /** True if edge direction in schema matches path direction */
  isForward: boolean;
}

/** Options for path finding */
export interface PathFinderOptions {
  /** Maximum path length to explore (default: 10) */
  maxDepth?: number;
  /** Maximum number of paths to return (default: 50) */
  maxPaths?: number;
  /** Whether to traverse edges bidirectionally (default: true) */
  bidirectional?: boolean;
}

// =============================================================================
// Path Finder Class
// =============================================================================

/**
 * PathFinder - Graph traversal algorithms for schema navigation.
 * 
 * Usage:
 * ```ts
 * const finder = new PathFinder(schema);
 * const shortest = finder.findShortestPath(startUri, endUri);
 * const all = finder.findAllPaths(startUri, endUri, { maxPaths: 10 });
 * const neighbors = finder.getNeighbors(nodeUri, 2);
 * ```
 */
export class PathFinder {
  private adjacency: Map<string, Array<{ neighbor: string; edge: CanonicalTriple; isOutgoing: boolean }>>;
  
  constructor(private schema: CanonicalSchema) {
    this.adjacency = this.buildAdjacency();
  }
  
  // ===========================================================================
  // Adjacency Building
  // ===========================================================================
  
  /**
   * Build bidirectional adjacency list from schema.
   */
  private buildAdjacency(): Map<string, Array<{ neighbor: string; edge: CanonicalTriple; isOutgoing: boolean }>> {
    const adj = new Map<string, Array<{ neighbor: string; edge: CanonicalTriple; isOutgoing: boolean }>>();
    
    const addEdge = (from: string, to: string, edge: CanonicalTriple, isOutgoing: boolean) => {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from)!.push({ neighbor: to, edge, isOutgoing });
    };
    
    for (const triple of this.schema.triples) {
      // Only consider URI objects for path finding (skip literals)
      if (triple.objectType !== 'uri') continue;
      
      // Outgoing: subject → object
      addEdge(triple.subject, triple.object, triple, true);
      
      // Incoming: object → subject (reversed direction)
      addEdge(triple.object, triple.subject, triple, false);
    }
    
    return adj;
  }
  
  /**
   * Rebuild adjacency (call after schema changes).
   */
  rebuild(): void {
    this.adjacency = this.buildAdjacency();
  }
  
  // ===========================================================================
  // Path Finding Algorithms
  // ===========================================================================
  
  /**
   * Find shortest path between two nodes using BFS.
   * Returns null if no path exists.
   * 
   * When startUri === endUri, looks for a self-loop edge (e.g. Protein→Protein)
   * rather than returning an empty trivial path.
   */
  findShortestPath(startUri: string, endUri: string, options: PathFinderOptions = {}): EdgePath | null {
    const maxDepth = options.maxDepth ?? 10;
    const bidirectional = options.bidirectional ?? true;
    
    // Self-loop: find direct self-referencing edges
    if (startUri === endUri) {
      const neighbors = this.adjacency.get(startUri) || [];
      for (const { neighbor, edge, isOutgoing } of neighbors) {
        if (neighbor === startUri && isOutgoing) {
          return {
            nodes: [startUri, endUri],
            edges: [{
              source: edge.subject,
              target: edge.object,
              predicate: edge.predicate,
              predicateLabel: edge.predicateLabel,
              isForward: true,
            }],
            length: 1,
          };
        }
      }
      // No self-loop edge found — return trivial path
      return { nodes: [startUri], edges: [], length: 0 };
    }
    
    // BFS with path tracking
    const visited = new Set<string>();
    const queue: Array<{ node: string; path: string[]; edges: PathEdgeInfo[] }> = [
      { node: startUri, path: [startUri], edges: [] }
    ];
    
    while (queue.length > 0) {
      const { node, path, edges } = queue.shift()!;
      
      if (path.length > maxDepth + 1) continue;
      
      if (visited.has(node)) continue;
      visited.add(node);
      
      const neighbors = this.adjacency.get(node) || [];
      
      for (const { neighbor, edge, isOutgoing } of neighbors) {
        if (!bidirectional && !isOutgoing) continue;
        if (visited.has(neighbor)) continue;
        
        const newEdge: PathEdgeInfo = {
          source: isOutgoing ? edge.subject : edge.object,
          target: isOutgoing ? edge.object : edge.subject,
          predicate: edge.predicate,
          predicateLabel: edge.predicateLabel,
          isForward: isOutgoing,
        };
        
        const newPath = [...path, neighbor];
        const newEdges = [...edges, newEdge];
        
        if (neighbor === endUri) {
          return { nodes: newPath, edges: newEdges, length: newEdges.length };
        }
        
        queue.push({ node: neighbor, path: newPath, edges: newEdges });
      }
    }
    
    return null;
  }
  
  /**
   * Find all paths between two nodes using DFS with backtracking.
   * When startUri === endUri, returns all self-loop edges as single-hop paths.
   */
  findAllPaths(startUri: string, endUri: string, options: PathFinderOptions = {}): EdgePath[] {
    const maxDepth = options.maxDepth ?? 10;
    const maxPaths = options.maxPaths ?? 50;
    const bidirectional = options.bidirectional ?? true;
    
    if (startUri === endUri) {
      const selfPaths: EdgePath[] = [];
      const neighbors = this.adjacency.get(startUri) || [];
      for (const { neighbor, edge, isOutgoing } of neighbors) {
        if (neighbor === startUri && isOutgoing) {
          selfPaths.push({
            nodes: [startUri, endUri],
            edges: [{
              source: edge.subject,
              target: edge.object,
              predicate: edge.predicate,
              predicateLabel: edge.predicateLabel,
              isForward: true,
            }],
            length: 1,
          });
        }
      }
      // Fallback: if no self-loop edges exist, return trivial empty path
      if (selfPaths.length === 0) {
        return [{ nodes: [startUri], edges: [], length: 0 }];
      }
      return selfPaths;
    }
    
    const allPaths: EdgePath[] = [];
    const visited = new Set<string>();
    
    const dfs = (current: string, path: string[], edges: PathEdgeInfo[]) => {
      if (allPaths.length >= maxPaths) return;
      if (path.length > maxDepth + 1) return;
      
      if (current === endUri) {
        allPaths.push({ nodes: [...path], edges: [...edges], length: edges.length });
        return;
      }
      
      visited.add(current);
      
      const neighbors = this.adjacency.get(current) || [];
      
      for (const { neighbor, edge, isOutgoing } of neighbors) {
        if (!bidirectional && !isOutgoing) continue;
        if (visited.has(neighbor)) continue;
        
        const newEdge: PathEdgeInfo = {
          source: isOutgoing ? edge.subject : edge.object,
          target: isOutgoing ? edge.object : edge.subject,
          predicate: edge.predicate,
          predicateLabel: edge.predicateLabel,
          isForward: isOutgoing,
        };
        
        path.push(neighbor);
        edges.push(newEdge);
        
        dfs(neighbor, path, edges);
        
        path.pop();
        edges.pop();
        
        if (allPaths.length >= maxPaths) break;
      }
      
      visited.delete(current);
    };
    
    dfs(startUri, [startUri], []);
    
    return allPaths;
  }
  
  /**
   * Get all nodes within N hops of a starting node.
   */
  getNeighborhood(startUri: string, maxHops: number, bidirectional = true): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ node: string; depth: number }> = [{ node: startUri, depth: 0 }];
    
    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      
      if (visited.has(node)) continue;
      visited.add(node);
      
      if (depth >= maxHops) continue;
      
      const neighbors = this.adjacency.get(node) || [];
      
      for (const { neighbor, isOutgoing } of neighbors) {
        if (!bidirectional && !isOutgoing) continue;
        if (!visited.has(neighbor)) {
          queue.push({ node: neighbor, depth: depth + 1 });
        }
      }
    }
    
    return visited;
  }
  
  /**
   * Get direct neighbors of a node (outgoing, incoming, or both).
   */
  getDirectNeighbors(
    nodeUri: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both'
  ): Array<{ uri: string; predicate: string; isOutgoing: boolean }> {
    const neighbors = this.adjacency.get(nodeUri) || [];
    
    return neighbors
      .filter(({ isOutgoing }) => {
        if (direction === 'both') return true;
        return direction === 'outgoing' ? isOutgoing : !isOutgoing;
      })
      .map(({ neighbor, edge, isOutgoing }) => ({
        uri: neighbor,
        predicate: edge.predicate,
        isOutgoing,
      }));
  }
  
  /**
   * Get all nodes connected to source that share a predicate type.
   */
  getConnectedByPredicate(sourceUri: string, predicateUri: string): string[] {
    const neighbors = this.adjacency.get(sourceUri) || [];
    return neighbors
      .filter(({ edge }) => edge.predicate === predicateUri)
      .map(({ neighbor }) => neighbor);
  }
  
  /**
   * Check if two nodes are connected (within maxHops).
   */
  areConnected(uri1: string, uri2: string, maxHops = 10): boolean {
    return this.findShortestPath(uri1, uri2, { maxDepth: maxHops }) !== null;
  }
  
  /**
   * Expand all edges from a path to handle multiple edges between same node pair.
   * Each unique edge sequence becomes a separate path variant.
   */
  expandPathToEdgeVariants(nodePath: string[]): EdgePath[] {
    if (nodePath.length < 2) {
      return [{ nodes: nodePath, edges: [], length: 0 }];
    }
    
    // For each consecutive pair, find all edges between them
    const edgeOptions: PathEdgeInfo[][] = [];
    
    for (let i = 0; i < nodePath.length - 1; i++) {
      const from = nodePath[i];
      const to = nodePath[i + 1];
      
      const neighbors = this.adjacency.get(from) || [];
      const edgesForPair: PathEdgeInfo[] = [];
      
      for (const { neighbor, edge, isOutgoing } of neighbors) {
        if (neighbor === to) {
          edgesForPair.push({
            source: isOutgoing ? edge.subject : edge.object,
            target: isOutgoing ? edge.object : edge.subject,
            predicate: edge.predicate,
            predicateLabel: edge.predicateLabel,
            isForward: isOutgoing,
          });
        }
      }
      
      edgeOptions.push(edgesForPair.length > 0 ? edgesForPair : [{ 
        source: from, 
        target: to, 
        predicate: '', 
        isForward: true 
      }]);
    }
    
    // Generate Cartesian product of all edge options
    const results: EdgePath[] = [];
    
    const generateCombinations = (index: number, currentEdges: PathEdgeInfo[]) => {
      if (index === edgeOptions.length) {
        results.push({
          nodes: nodePath,
          edges: [...currentEdges],
          length: currentEdges.length,
        });
        return;
      }
      
      for (const edge of edgeOptions[index]) {
        currentEdges.push(edge);
        generateCombinations(index + 1, currentEdges);
        currentEdges.pop();
      }
    };
    
    generateCombinations(0, []);
    return results;
  }
}

