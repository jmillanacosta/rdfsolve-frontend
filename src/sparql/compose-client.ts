/**
 * Compose API Client
 *
 * Calls the backend `/api/compose/from-paths` endpoint to generate
 * SPARQL queries from diagram paths.  The backend owns ALL query
 * composition logic (variable naming, fan-pattern reuse, type
 * assertions, label clauses, VALUES bindings, etc.).
 *
 * The frontend just serialises the path data and options, sends them
 * over, and receives the finished query string.
 */

import type { EnhancedPath } from '../state/diagram-state';

// ── API base ─────────────────────────────────────────────────────────────────

const API_BASE: string = (globalThis as any).__RDFSOLVE_API_BASE__ ?? '';

// ── Types matching backend contract ──────────────────────────────────────────

export interface ComposeOptions {
  include_types?: boolean;
  include_labels?: boolean;
  limit?: number;
  value_bindings?: Record<string, string[]>;
}

export interface ComposeResult {
  query: string;
  variable_map: Record<string, string>;
  jsonld: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert frontend `EnhancedPath[]` + `nodeIdToUri` into the API's
 * `paths` format:
 * ```json
 * [{ "edges": [{ "source": "uri", "target": "uri",
 *                "predicate": "uri", "is_forward": true }] }]
 * ```
 *
 * The backend expects real URIs (not node IDs) in source/target.
 * `edgeData` already stores URIs, so no mapping is needed.
 */
function serialisePaths(
  paths: EnhancedPath[],
): Array<{ edges: Array<{ source: string; target: string; predicate: string; is_forward: boolean }> }> {
  return paths
    .filter(p => p.edgeData && p.edgeData.length > 0)
    .map(p => ({
      edges: p.edgeData!.map(e => ({
        source: e.source,
        target: e.target,
        predicate: e.predicate,
        is_forward: e.isForward,
      })),
    }));
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Ask the backend to compose a SPARQL query from diagram paths.
 *
 * @param paths       Enhanced paths from the diagram state.
 * @param prefixes    Namespace prefix map (e.g. from the schema).
 * @param options     Generation options (types, labels, limit, bindings).
 * @returns           The composed query string (or a comment on error).
 */
export async function composeFromPaths(
  paths: EnhancedPath[],
  prefixes: Record<string, string>,
  options: ComposeOptions = {},
): Promise<ComposeResult> {
  const apiPaths = serialisePaths(paths);

  if (apiPaths.length === 0) {
    return {
      query: '# No paths selected. Draw paths in the diagram first.',
      variable_map: {},
      jsonld: {},
    };
  }

  const res = await fetch(`${API_BASE}/api/compose/from-paths`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paths: apiPaths,
      prefixes,
      options,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as any).error || `HTTP ${res.status}`;
    return {
      query: `# Error composing query: ${msg}`,
      variable_map: {},
      jsonld: {},
    };
  }

  return (await res.json()) as ComposeResult;
}
