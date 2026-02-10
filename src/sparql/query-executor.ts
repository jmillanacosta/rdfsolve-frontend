/**
 * SPARQL Query Executor
 *
 * Sends SPARQL SELECT queries to endpoints, parses the JSON results,
 * and maps each result variable back to the schema URI it was derived
 * from (using the variable→URI mapping produced by SPARQLComposer).
 *
 * Design:
 *  - Pure data module — no DOM, no side-effects.
 *  - Single `executeQuery()` entry point returns a strongly typed result.
 *  - Callers (results-panel, diagram) consume the result to render
 *    tables and populate instance badges on the diagram.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** One cell in a result row. */
export interface ResultCell {
  value: string;
  type: 'uri' | 'literal' | 'bnode';
  /** Language tag (for literals) */
  lang?: string;
  /** Datatype URI (for typed literals) */
  datatype?: string;
}

/** A single result binding row: variableName → cell */
export type ResultRow = Record<string, ResultCell>;

/** Mapping from SPARQL ?variable name → schema class/node URI it represents. */
export type VariableMapping = Map<string, string>;

/** Full execution result. */
export interface QueryResult {
  /** The SPARQL query that was executed. */
  query: string;
  /** Endpoint that was queried. */
  endpoint: string;
  /** Ordered variable names from the result head. */
  variables: string[];
  /** Result rows. */
  rows: ResultRow[];
  /** Variable → schema URI mapping (for traceability). */
  variableMap: VariableMapping;
  /** Total rows returned. */
  rowCount: number;
  /** Execution time in ms. */
  durationMs: number;
  /** Error message, if any. */
  error?: string;
}

/** Options for executeQuery. */
export interface ExecuteOptions {
  /** Timeout in ms (default: 30 000). */
  timeout?: number;
  /** HTTP method: GET (default) or POST. */
  method?: 'GET' | 'POST';
}

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Send a SPARQL SELECT query to an endpoint and return structured results.
 *
 * @param query       The full SPARQL query string (including PREFIXes).
 * @param endpoint    The SPARQL endpoint URL.
 * @param variableMap Maps each ?variable in the query to the schema URI
 *                    it was generated from (produced by the composer).
 * @param options     Timeout, HTTP method.
 */
export async function executeQuery(
  query: string,
  endpoint: string,
  variableMap: VariableMapping = new Map(),
  options: ExecuteOptions = {},
): Promise<QueryResult> {
  const { timeout = 30_000, method = 'GET' } = options;
  const t0 = performance.now();

  try {
    const json = await fetchSparqlJson(endpoint, query, timeout, method);
    const variables: string[] = json.head?.vars ?? [];
    const rows: ResultRow[] = (json.results?.bindings ?? []).map(
      (binding: Record<string, SparqlJsonCell>) => {
        const row: ResultRow = {};
        for (const v of variables) {
          const cell = binding[v];
          if (cell) {
            row[v] = {
              value: cell.value,
              type: cell.type === 'uri' ? 'uri'
                : cell.type === 'bnode' ? 'bnode'
                : 'literal',
              lang: cell['xml:lang'],
              datatype: cell.datatype,
            };
          }
        }
        return row;
      },
    );

    return {
      query, endpoint, variables, rows, variableMap,
      rowCount: rows.length,
      durationMs: Math.round(performance.now() - t0),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      query, endpoint, variables: [], rows: [], variableMap,
      rowCount: 0,
      durationMs: Math.round(performance.now() - t0),
      error: msg,
    };
  }
}

// ── Variable → Schema mapping builder ────────────────────────────────────────

/**
 * Build a VariableMapping by parsing the SPARQL query text for
 * `?var a <URI>` or `?var a prefix:Local` patterns and expanding CURIEs.
 *
 * This is a lightweight heuristic — the composer already embeds rdf:type
 * assertions so we can recover the mapping. For queries without type
 * assertions the mapping will simply be empty (no traceability).
 */
export function buildVariableMapFromQuery(
  query: string,
  prefixes: Record<string, string>,
): VariableMapping {
  const map: VariableMapping = new Map();

  // Match ?var a curie . or ?var a <uri> .
  const re = /\?(\w+)\s+a\s+(?:(\w[\w.-]*:\w[\w.-]*)|<([^>]+)>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const varName = m[1];
    let uri: string;
    if (m[3]) {
      uri = m[3];
    } else if (m[2]) {
      const [pfx, local] = m[2].split(':');
      const ns = prefixes[pfx];
      uri = ns ? ns + local : m[2];
    } else continue;
    if (!map.has(varName)) map.set(varName, uri);
  }

  // Also try variable name → schema URI by looking for
  // subject-position variables: `?varName predicate ?other`
  // These are less reliable so we don't overwrite existing entries.
  return map;
}

/**
 * Build a mapping from each variable to its positional schema URI
 * using the same logic the composer uses: each node position in a path
 * gets a variable named after its local name.
 *
 * This is the preferred approach when you have the paths available.
 */
export function buildVariableMapFromPaths(
  paths: Array<{
    edgeData?: Array<{
      source: string;
      target: string;
      predicate: string;
      isForward: boolean;
    }>;
  }>,
): VariableMapping {
  const map: VariableMapping = new Map();
  const counter: Record<string, number> = {};

  const freshVar = (uri: string): string => {
    let ln = uri.includes('#') ? uri.split('#').pop()! : uri.split('/').pop()!;
    ln = ln.replace(/[^a-zA-Z0-9_]/g, '') || 'node';
    const base = ln.charAt(0).toLowerCase() + ln.slice(1);
    if (!counter[base]) counter[base] = 0;
    const suffix = counter[base] === 0 ? '' : `_${counter[base]}`;
    counter[base]++;
    return `${base}${suffix}`;
  };

  for (const path of paths) {
    if (!path.edgeData?.length) continue;
    for (let ei = 0; ei < path.edgeData.length; ei++) {
      const edge = path.edgeData[ei];
      const subj = edge.isForward ? edge.source : edge.target;
      const obj = edge.isForward ? edge.target : edge.source;
      if (ei === 0) {
        const v = freshVar(subj);
        map.set(v, subj);
      }
      const v = freshVar(obj);
      map.set(v, obj);
    }
  }
  return map;
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

/**
 * For each schema URI in the variable map, collect all distinct instance
 * IRIs that appeared in the results for that variable.
 *
 * Returns: schemaUri → Set of instance IRIs.
 */
export function collectInstancesBySchemaNode(
  result: QueryResult,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [varName, schemaUri] of result.variableMap) {
    const instances = new Set<string>();
    for (const row of result.rows) {
      const cell = row[varName];
      if (cell?.type === 'uri') instances.add(cell.value);
    }
    if (instances.size > 0) {
      const existing = map.get(schemaUri);
      if (existing) {
        for (const iri of instances) existing.add(iri);
      } else {
        map.set(schemaUri, instances);
      }
    }
  }
  return map;
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Raw SPARQL JSON cell shape. */
interface SparqlJsonCell {
  type: string;
  value: string;
  'xml:lang'?: string;
  datatype?: string;
}

/** Fetch SPARQL endpoint, return parsed JSON. */
async function fetchSparqlJson(
  endpoint: string,
  query: string,
  timeout: number,
  method: 'GET' | 'POST',
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    let res: Response;
    if (method === 'POST') {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          Accept: 'application/sparql-results+json',
        },
        body: query,
        signal: ctrl.signal,
        mode: 'cors',
      });
    } else {
      const url = `${endpoint}?query=${encodeURIComponent(query)}&format=json`;
      res = await fetch(url, {
        headers: { Accept: 'application/sparql-results+json' },
        signal: ctrl.signal,
        mode: 'cors',
      });
    }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timeout');
    }
    if (err instanceof TypeError && (err as any).message?.includes('Failed to fetch')) {
      throw new Error('CORS blocked or network error');
    }
    throw err;
  }
}
