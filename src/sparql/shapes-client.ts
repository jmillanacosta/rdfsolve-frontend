/**
 * Shapes API Client
 *
 * Calls the backend `/api/shapes/*` endpoints:
 *  - `/api/shapes/subset`  – Subset a JSON-LD schema by edges
 *  - `/api/shapes/shacl`   – Convert JSON-LD (subset) → SHACL Turtle
 */

// ── API base ────────────────────────────────────────────────────

const API_BASE: string = (globalThis as any).__RDFSOLVE_API_BASE__ ?? '';

// ── Types ───────────────────────────────────────────────────────

export interface EdgeSpec {
  subject: string;
  predicate: string;
  object: string;
}

export interface SubsetResult {
  '@context': Record<string, string>;
  '@graph': Array<Record<string, unknown>>;
  '@about'?: Record<string, unknown>;
}

export interface ShaclResult {
  shacl: string;
  error?: string;
}

// ── Subset ──────────────────────────────────────────────────────

/**
 * Subset a JSON-LD schema, keeping only the specified edges.
 */
export async function subsetSchema(
  schemaJsonld: Record<string, unknown>,
  keepEdges: EdgeSpec[],
): Promise<SubsetResult> {
  const res = await fetch(`${API_BASE}/api/shapes/subset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema_jsonld: schemaJsonld,
      keep_edges: keepEdges,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }

  return (await res.json()) as SubsetResult;
}

// ── SHACL conversion ────────────────────────────────────────────

/**
 * Convert a JSON-LD schema (full or subset) to SHACL shapes.
 */
export async function generateShacl(
  schemaJsonld: Record<string, unknown>,
  options?: { schemaName?: string; closed?: boolean },
): Promise<ShaclResult> {
  const res = await fetch(`${API_BASE}/api/shapes/shacl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema_jsonld: schemaJsonld,
      schema_name: options?.schemaName,
      closed: options?.closed ?? true,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { shacl: '', error: (body as any).error || `HTTP ${res.status}` };
  }

  return (await res.json()) as ShaclResult;
}
