/**
 * SPARQL Composer - Enhanced
 * 
 * Generates SPARQL queries from diagram paths and selections.
 * Supports:
 * - Multi-path query generation
 * - Federated queries with SERVICE clauses
 * - TYPE assertions
 * - OPTIONAL labels
 * - VALUES clauses for filtering
 * - JSON-LD output using sh:SPARQLExecutable
 */

import type {
  PrefixMap,
  PathHighlight,
  CanonicalSchema,
  SPARQLExecutableJSONLD,
} from '../types';
import { STANDARD_PREFIXES } from '../types';
import { compactUriOrBracket } from '../iri/uri-utils';
import type { EnhancedPath } from '../state/diagram-state';
import type { EdgePath, PathEdgeInfo } from '../algorithms/path-finder';

// =============================================================================
// Types
// =============================================================================

export interface SPARQLComposerOptions {
  prefixes?: PrefixMap;
  includeLimit?: number;
  endpoint?: string;
  /** Include rdf:type assertions for nodes */
  includeTypes?: boolean;
  /** Include OPTIONAL label clauses */
  includeLabels?: boolean;
}

export interface EndpointInfo {
  endpoint: string;
  graph?: string;
}

export interface DatasetEndpoints {
  [datasetName: string]: EndpointInfo;
}

export interface QueryGenerationOptions {
  /** Primary endpoint (patterns here don't need SERVICE wrapper) */
  primaryEndpoint?: string;
  /** Endpoints for each dataset */
  datasetEndpoints?: DatasetEndpoints;
  /** Include rdf:type assertions */
  includeTypes?: boolean;
  /** Include OPTIONAL rdfs:label clauses */
  includeLabels?: boolean;
  /** VALUES clause bindings */
  valueBindings?: Map<string, string[]>;
  /** Limit results */
  limit?: number;
}

// =============================================================================
// SPARQL Composer Class
// =============================================================================

/**
 * SPARQLComposer - Generate SPARQL queries from paths.
 * 
 * Usage:
 * ```ts
 * const composer = new SPARQLComposer({ prefixes: myPrefixes });
 * 
 * // Simple query from paths
 * const query = composer.generateFromPaths(schema, paths);
 * 
 * // Federated query with endpoints
 * const fedQuery = composer.generateFromPaths(schema, paths, {
 *   primaryEndpoint: 'https://sparql.example.org/query',
 *   datasetEndpoints: { 'dataset1': { endpoint: 'https://other.org/sparql' } }
 * });
 * ```
 */
export class SPARQLComposer {
  private prefixes: PrefixMap;
  
  constructor(private options: SPARQLComposerOptions = {}) {
    this.prefixes = {
      ...STANDARD_PREFIXES,
      ...options.prefixes,
    };
  }
  
  /**
   * Update prefixes.
   */
  setPrefixes(prefixes: PrefixMap): void {
    this.prefixes = { ...this.prefixes, ...prefixes };
  }
  
  /**
   * Generate prefix declarations for SPARQL.
   */
  generatePrefixes(): string {
    const lines: string[] = [];
    for (const [prefix, namespace] of Object.entries(this.prefixes)) {
      lines.push(`PREFIX ${prefix}: <${namespace}>`);
    }
    return lines.join('\n');
  }
  
  /**
   * Generate a SELECT query from a path through the schema.
   */
  generateSelectFromPath(
    schema: CanonicalSchema,
    path: PathHighlight,
    variablePrefix = '?'
  ): string {
    const parts: string[] = [this.generatePrefixes(), ''];
    
    // Build triple patterns from path
    const patterns: string[] = [];
    const variables: string[] = [];
    
    // Get triples that make up this path
    const pathTriples = this.getPathTriples(schema, path);
    
    let varCounter = 0;
    const uriToVar = new Map<string, string>();
    
    const getVar = (uri: string): string => {
      let v = uriToVar.get(uri);
      if (!v) {
        v = `${variablePrefix}v${varCounter++}`;
        uriToVar.set(uri, v);
        variables.push(v);
      }
      return v;
    };
    
    for (const triple of pathTriples) {
      const s = getVar(triple.subject);
      const p = compactUriOrBracket(triple.predicate, this.prefixes);
      const o = triple.objectType === 'literal' 
        ? `"${triple.object}"` 
        : getVar(triple.object);
      
      patterns.push(`  ${s} ${p} ${o} .`);
    }
    
    parts.push(`SELECT ${variables.join(' ')}`);
    parts.push('WHERE {');
    parts.push(...patterns);
    parts.push('}');
    
    if (this.options.includeLimit) {
      parts.push(`LIMIT ${this.options.includeLimit}`);
    }
    
    return parts.join('\n');
  }
  
  /**
   * Generate a CONSTRUCT query from a path.
   */
  generateConstructFromPath(
    schema: CanonicalSchema,
    path: PathHighlight
  ): string {
    const parts: string[] = [this.generatePrefixes(), ''];
    
    const pathTriples = this.getPathTriples(schema, path);
    const patterns: string[] = [];
    
    let varCounter = 0;
    const uriToVar = new Map<string, string>();
    
    const getVar = (uri: string): string => {
      let v = uriToVar.get(uri);
      if (!v) {
        v = `?v${varCounter++}`;
        uriToVar.set(uri, v);
      }
      return v;
    };
    
    for (const triple of pathTriples) {
      const s = getVar(triple.subject);
      const p = compactUriOrBracket(triple.predicate, this.prefixes);
      const o = triple.objectType === 'literal' 
        ? `"${triple.object}"` 
        : getVar(triple.object);
      
      patterns.push(`  ${s} ${p} ${o} .`);
    }
    
    parts.push('CONSTRUCT {');
    parts.push(...patterns);
    parts.push('}');
    parts.push('WHERE {');
    parts.push(...patterns);
    parts.push('}');
    
    if (this.options.includeLimit) {
      parts.push(`LIMIT ${this.options.includeLimit}`);
    }
    
    return parts.join('\n');
  }
  
  /**
   * Generate JSON-LD representation of a SPARQL query.
   */
  toJSONLD(
    queryType: 'select' | 'construct' | 'ask',
    query: string,
    description?: string
  ): SPARQLExecutableJSONLD {
    const result: SPARQLExecutableJSONLD = {
      '@context': {
        ...this.prefixes,
        sh: 'http://www.w3.org/ns/shacl#',
        schema: 'https://schema.org/',
        sd: 'http://www.w3.org/ns/sparql-service-description#',
      },
      '@id': `_:query_${Date.now()}`,
      '@type': ['sh:SPARQLExecutable', `sh:SPARQL${capitalize(queryType)}Executable`],
      'sh:prefixes': this.prefixes,
      'schema:dateCreated': new Date().toISOString(),
    };
    
    if (queryType === 'select') {
      result['sh:select'] = query;
    } else if (queryType === 'construct') {
      result['sh:construct'] = query;
    } else if (queryType === 'ask') {
      result['sh:ask'] = query;
    }
    
    if (description) {
      result['schema:description'] = description;
    }
    
    if (this.options.endpoint) {
      result['schema:target'] = {
        '@type': 'sd:Service',
        'sd:endpoint': this.options.endpoint,
      };
    }
    
    return result;
  }
  
  // ===========================================================================
  // Advanced Query Generation from Multiple Paths
  // ===========================================================================
  
  /**
   * Generate a SELECT query from multiple paths.
   * This is the main method for generating queries from user-drawn paths.
   * 
   * Each path's edgeData contains real schema edges:
   *   { source: subjectURI, target: objectURI, predicate: predicateURI, isForward }
   * 
   * We turn each edge into a triple pattern:  ?subject predicate ?object
   * If the edge is reversed (isForward=false), we swap source/target.
   * 
   * Supports:
   * - DISTINCT SELECT with readable variable names derived from URI local names
   * - Deduplication of triple patterns across all paths
   * - OPTIONAL rdfs:label + dc:title clauses (toggleable)
   * - rdf:type assertions (toggleable) — adds ?var a <TypeURI> for class nodes
   * - VALUES clause from IRI bindings
   * - LIMIT clause
   * - Federated SERVICE clauses for non-primary endpoints
   * - GRAPH wrapping for named graphs
   */
  generateFromPaths(
    paths: EnhancedPath[],
    nodeUriMap: Map<string, string>,  // nodeId -> URI
    options: QueryGenerationOptions = {}
  ): string {
    if (paths.length === 0) {
      return '# No paths selected';
    }
    
    const {
      primaryEndpoint = '',
      datasetEndpoints = {},
      includeTypes = false,
      includeLabels = true,
      valueBindings,
      limit = 100,
    } = options;
    
    // Variable name generation — positional, not URI-based.
    // Each node *position* in a path gets its own variable so that
    // reflexive edges (Protein → Protein) produce ?protein / ?protein1
    // instead of the same variable on both sides.
    const varNameCounter: Record<string, number> = {};
    const selectVars: string[] = [];  // ordered list for SELECT

    /** Create a fresh variable whose name is derived from the URI local name. */
    const freshVar = (uri: string): string => {
      let ln = uri.includes('#') ? uri.split('#').pop()! : uri.split('/').pop()!;
      ln = ln.replace(/[^a-zA-Z0-9_]/g, '');
      if (!ln) ln = 'node';
      const baseName = ln.charAt(0).toLowerCase() + ln.slice(1);

      if (!varNameCounter[baseName]) varNameCounter[baseName] = 0;
      const suffix = varNameCounter[baseName] === 0 ? '' : `_${varNameCounter[baseName]}`;
      varNameCounter[baseName]++;

      const v = `${baseName}${suffix}`;
      selectVars.push(v);
      return v;
    };

    // ---- Collect all triple patterns from path edges ----
    // Each pattern is { subjVar, predCurie, objVar, endpoint?, graph? }
    interface PatternInfo {
      text: string;           // The triple pattern text: "  ?x pred:y ?z ."
      endpoint?: string;      // Which endpoint this pattern belongs to
      graph?: string;         // Named graph wrapping
    }

    const allPatterns: PatternInfo[] = [];
    const seenPatterns = new Set<string>();
    const typeAssertions: string[] = [];

    for (const path of paths) {
      if (!path.edgeData || path.edgeData.length === 0) {
        for (const nodeId of path.nodeIds) {
          const uri = nodeUriMap.get(nodeId);
          if (uri) freshVar(uri);
        }
        continue;
      }

      // Walk edges in order.  The first edge's subject starts a new var;
      // each edge's object always gets a new var (even if same URI).
      // This means position 0 = subject of edge 0, position 1 = object of
      // edge 0 = subject of edge 1, etc.
      const positionVars: string[] = [];  // one var per node position in this path

      for (let ei = 0; ei < path.edgeData.length; ei++) {
        const edge = path.edgeData[ei];
        const realSubject = edge.isForward ? edge.source : edge.target;
        const realObject = edge.isForward ? edge.target : edge.source;

        // Subject var: first edge creates it, later edges reuse previous object
        if (ei === 0) {
          positionVars.push(freshVar(realSubject));
        }
        // Object var: always a fresh variable for each new position
        positionVars.push(freshVar(realObject));

        const subjVar = positionVars[ei];
        const objVar = positionVars[ei + 1];

        const predSparql = edge.predicate
          ? compactUriOrBracket(edge.predicate, this.prefixes)
          : '?p';

        const patText = `  ?${subjVar} ${predSparql} ?${objVar} .`;
        
        if (!seenPatterns.has(patText)) {
          seenPatterns.add(patText);
          allPatterns.push({ text: patText });
        }
      }

      // rdf:type assertions
      if (includeTypes) {
        for (let pi = 0; pi < positionVars.length; pi++) {
          // Resolve the URI for this position from the edges
          let uri: string | undefined;
          if (pi === 0 && path.edgeData.length > 0) {
            const e = path.edgeData[0];
            uri = e.isForward ? e.source : e.target;
          } else if (pi > 0 && pi - 1 < path.edgeData.length) {
            const e = path.edgeData[pi - 1];
            uri = e.isForward ? e.target : e.source;
          }
          if (uri) {
            const v = positionVars[pi];
            const typePattern = `  ?${v} a ${compactUriOrBracket(uri, this.prefixes)} .`;
            if (!seenPatterns.has(typePattern)) {
              seenPatterns.add(typePattern);
              typeAssertions.push(typePattern);
            }
          }
        }
      }
    }

    // ---- Build query ----
    const parts: string[] = [];
    
    // Prefixes
    parts.push(this.generatePrefixes());
    parts.push('');
    
    // SELECT clause with optional label variables
    const labelVars = includeLabels
      ? selectVars.map(v => `?${v}Label`)
      : [];
    
    const allSelectVars = [
      ...selectVars.map(v => `?${v}`),
      ...labelVars,
    ];
    parts.push(`SELECT DISTINCT ${allSelectVars.join(' ')}`);
    
    // WHERE clause
    parts.push('WHERE {');
    
    // VALUES bindings
    if (valueBindings && valueBindings.size > 0) {
      for (const [varName, values] of valueBindings) {
        const valuesStr = values.map(v => `<${v}>`).join(' ');
        parts.push(`  VALUES ?${varName} { ${valuesStr} }`);
      }
      parts.push('');
    }
    
    // Group patterns by endpoint for federated queries
    const hasEndpoints = primaryEndpoint && Object.keys(datasetEndpoints).length > 0;
    
    if (hasEndpoints) {
      // Group patterns that belong to non-primary endpoints
      const primaryPatterns: string[] = [];
      const endpointGroups = new Map<string, { patterns: string[]; graph?: string }>();
      
      for (const pat of allPatterns) {
        if (!pat.endpoint || pat.endpoint === primaryEndpoint) {
          primaryPatterns.push(pat.text);
        } else {
          if (!endpointGroups.has(pat.endpoint)) {
            endpointGroups.set(pat.endpoint, { patterns: [], graph: pat.graph });
          }
          endpointGroups.get(pat.endpoint)!.patterns.push(pat.text);
        }
      }
      
      // Primary patterns (no SERVICE wrapper)
      if (primaryPatterns.length > 0) {
        parts.push(...primaryPatterns);
      }
      
      // Non-primary patterns wrapped in SERVICE clauses
      for (const [endpoint, group] of endpointGroups) {
        parts.push('');
        parts.push(`  SERVICE <${endpoint}> {`);
        if (group.graph) {
          parts.push(`    GRAPH <${group.graph}> {`);
          for (const p of group.patterns) {
            parts.push(`    ${p}`);
          }
          parts.push(`    }`);
        } else {
          for (const p of group.patterns) {
            parts.push(`  ${p}`);
          }
        }
        parts.push(`  }`);
      }
    } else {
      // No federation — all patterns go directly
      parts.push(...allPatterns.map(p => p.text));
    }
    
    // Type assertions
    if (typeAssertions.length > 0) {
      parts.push('');
      parts.push('  # rdf:type assertions');
      parts.push(...typeAssertions);
    }
    
    // OPTIONAL label clauses (rdfs:label + dc:title fallback)
    if (includeLabels && selectVars.length > 0) {
      parts.push('');
      for (const varName of selectVars) {
        parts.push(`  OPTIONAL { ?${varName} rdfs:label ?${varName}Label . }`);
        parts.push(`  OPTIONAL { ?${varName} dc:title ?${varName}Label . }`);
      }
    }
    
    parts.push('}');
    
    // LIMIT
    if (limit) {
      parts.push(`LIMIT ${limit}`);
    }
    
    return parts.join('\n');
  }
  
  /**
   * Generate query from EdgePath objects (from PathFinder).
   * EdgePath edges have { source, target, predicate, isForward }.
   * Supports all the same options as generateFromPaths.
   */
  generateFromEdgePaths(
    edgePaths: EdgePath[],
    options: QueryGenerationOptions = {}
  ): string {
    if (edgePaths.length === 0) {
      return '# No paths';
    }
    
    const {
      includeLabels = true,
      includeTypes = false,
      limit = 100,
    } = options;
    
    // Positional variable generation (same approach as generateFromPaths)
    const varNameCounter: Record<string, number> = {};
    const selectVars: string[] = [];
    
    const freshVar = (uri: string): string => {
      let ln = uri.includes('#') ? uri.split('#').pop()! : uri.split('/').pop()!;
      ln = ln.replace(/[^a-zA-Z0-9_]/g, '') || 'node';
      const baseName = ln.charAt(0).toLowerCase() + ln.slice(1);
      
      if (!varNameCounter[baseName]) varNameCounter[baseName] = 0;
      const suffix = varNameCounter[baseName] === 0 ? '' : `_${varNameCounter[baseName]}`;
      varNameCounter[baseName]++;
      
      const v = `${baseName}${suffix}`;
      selectVars.push(v);
      return v;
    };
    
    // Collect triple patterns
    const patterns: string[] = [];
    const seen = new Set<string>();
    
    for (const path of edgePaths) {
      // Walk edges in order, assigning a fresh variable per node position
      const positionVars: string[] = [];

      for (let ei = 0; ei < path.edges.length; ei++) {
        const edge = path.edges[ei];
        const realSubject = edge.isForward ? edge.source : edge.target;
        const realObject  = edge.isForward ? edge.target  : edge.source;

        if (ei === 0) {
          positionVars.push(freshVar(realSubject));
        }
        positionVars.push(freshVar(realObject));

        const subjVar = positionVars[ei];
        const objVar  = positionVars[ei + 1];
        
        const predSparql = edge.predicate ? compactUriOrBracket(edge.predicate, this.prefixes) : '?p';
        const pat = `  ?${subjVar} ${predSparql} ?${objVar} .`;
        if (!seen.has(pat)) {
          seen.add(pat);
          patterns.push(pat);
        }
      }

      // rdf:type assertions
      if (includeTypes) {
        for (let pi = 0; pi < positionVars.length; pi++) {
          let uri: string | undefined;
          if (pi === 0 && path.edges.length > 0) {
            const e = path.edges[0];
            uri = e.isForward ? e.source : e.target;
          } else if (pi > 0 && pi - 1 < path.edges.length) {
            const e = path.edges[pi - 1];
            uri = e.isForward ? e.target : e.source;
          }
          if (uri) {
            const v = positionVars[pi];
            const typePat = `  ?${v} a ${compactUriOrBracket(uri, this.prefixes)} .`;
            if (!seen.has(typePat)) {
              seen.add(typePat);
              patterns.push(typePat);
            }
          }
        }
      }
    }
    
    // Build query
    const parts: string[] = [this.generatePrefixes(), ''];
    
    const labelVars = includeLabels 
      ? selectVars.map(v => `?${v}Label`)
      : [];
    
    parts.push(`SELECT DISTINCT ${selectVars.map(v => `?${v}`).join(' ')} ${labelVars.join(' ')}`);
    parts.push('WHERE {');
    parts.push(...patterns);
    
    if (includeLabels && selectVars.length > 0) {
      parts.push('');
      for (const varName of selectVars) {
        parts.push(`  OPTIONAL { ?${varName} rdfs:label ?${varName}Label . }`);
        parts.push(`  OPTIONAL { ?${varName} dc:title ?${varName}Label . }`);
      }
    }
    
    parts.push('}');
    if (limit) parts.push(`LIMIT ${limit}`);
    
    return parts.join('\n');
  }
  
  /**
   * Get triples that make up a path.
   */
  private getPathTriples(
    schema: CanonicalSchema,
    path: PathHighlight
  ): Array<{ subject: string; predicate: string; object: string; objectType: string }> {
    const result: Array<{ subject: string; predicate: string; object: string; objectType: string }> = [];
    
    for (const edgeId of path.edgeIds) {
      for (const triple of schema.triples) {
        if (path.nodeIds.includes(triple.subject) && path.nodeIds.includes(triple.object)) {
          if (!result.some(t => 
            t.subject === triple.subject && 
            t.predicate === triple.predicate && 
            t.object === triple.object
          )) {
            result.push({
              subject: triple.subject,
              predicate: triple.predicate,
              object: triple.object,
              objectType: triple.objectType,
            });
          }
        }
      }
    }
    
    return result;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
