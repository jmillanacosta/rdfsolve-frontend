/**
 * SPARQL Query Executor
 */
const API_BASE: string = (globalThis as any).__RDFSOLVE_API_BASE__ ?? '';

/** One cell in a result row. */
export interface ResultCell {
  value: string;
  type: 'uri' | 'literal' | 'bnode';
  /** Language tag (for literals) */
  lang?: string;
  /** Datatype URI (for typed literals) */
  datatype?: string;
}

/** A single result binding row: variableName -> cell */
export type ResultRow = Record<string, ResultCell>;

/** Mapping from SPARQL ?variable name -> schema class/node URI it represents. */
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
  /** Variable -> schema URI mapping (for traceability). */
  variableMap: VariableMapping;
  /** Total rows returned. */
  rowCount: number;
  /** Execution time in ms. */
  durationMs: number;
  /** Error message, if any. */
  error?: string;
  /** Python code snippet to reproduce this operation. */
  rdfsolveCode?: string;
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
 * Send a SPARQL SELECT query to an endpoint **via the backend proxy**.
 *
 * The request is POSTed to /api/sparql/query, which forwards it to the
 * remote SPARQL endpoint server-side (no CORS issues).
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout + 5000);

    const res = await fetch(`${API_BASE}/api/sparql/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        endpoint,
        method,
        timeout: Math.round(timeout / 1000),
        variable_map: Object.fromEntries(variableMap),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // Map snake_case backend response -> camelCase frontend types
    const variables: string[] = data.variables ?? [];
    const rows: ResultRow[] = (data.rows ?? []).map(
      (row: Record<string, any>) => {
        const mapped: ResultRow = {};
        for (const v of variables) {
          const cell = row[v];
          if (cell) {
            mapped[v] = {
              value: cell.value,
              type: cell.type === 'uri' ? 'uri'
                : cell.type === 'bnode' ? 'bnode'
                : 'literal',
              lang: cell.lang ?? undefined,
              datatype: cell.datatype ?? undefined,
            };
          }
        }
        return mapped;
      },
    );

    // Merge backend variable_map with caller-provided variableMap
    const mergedMap: VariableMapping = new Map(variableMap);
    if (data.variable_map) {
      for (const [k, v] of Object.entries(data.variable_map)) {
        if (!mergedMap.has(k)) mergedMap.set(k, v as string);
      }
    }

    return {
      query: data.query ?? query,
      endpoint: data.endpoint ?? endpoint,
      variables,
      rows,
      variableMap: mergedMap,
      rowCount: data.row_count ?? rows.length,
      durationMs: data.duration_ms ?? Math.round(performance.now() - t0),
      error: data.error ?? undefined,
      rdfsolveCode: data.rdfsolve_code ?? undefined,
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

// ── Variable -> Schema mapping builder ────────────────────────────────────────

/**
 * Build a VariableMapping by parsing the SPARQL query text for
 * `?var a <URI>` or `?var a prefix:Local` patterns and expanding CURIEs.
 *
 * This is a lightweight heuristic - the composer already embeds rdf:type
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

  // Also try variable name -> schema URI by looking for
  // subject-position variables: `?varName predicate ?other`
  // These are less reliable so we don't overwrite existing entries.
  return map;
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

/**
 * For each schema URI in the variable map, collect all distinct instance
 * IRIs that appeared in the results for that variable.
 *
 * Returns: schemaUri -> Set of instance IRIs.
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


