/**
 * API-driven Entry Point
 *
 * Instead of hardcoded DATASETS, fetches the list from /api/schemas
 * and wires them into the existing components.
 *
 * Usage (build):
 *   npx esbuild src/api-entry.ts --bundle --outfile=demo/dist/bundle.js \
 *     --format=esm --target=es2020 --sourcemap
 */

// Register all web components
import './components/schema-diagram';
import './components/dataset-selector';
import './components/find-node';
import './components/sparql-editor';
import './components/path-list';
import './components/node-tooltip';
import './components/iri-resolver';
import './components/diagram-settings';
import './components/results-panel';
import './components/code-log';

// Apply default style
import { setStyle, DEFAULT_STYLE } from './layout/styles';

import type { DatasetSelector } from './components/dataset-selector';
import type { FindNode } from './components/find-node';
import type { SparqlEditor } from './components/sparql-editor';
import type { PathList } from './components/path-list';
import type { IriResolver } from './components/iri-resolver';
import type { ResultsPanel } from './components/results-panel';

// =====================================================================
// CONFIGURATION
// =====================================================================

/** Color palette for auto-assigned dataset colours. */
const PALETTE = [
  'hsl(210,65%,50%)', 'hsl(140,65%,40%)', 'hsl(30,65%,50%)',
  'hsl(60,65%,50%)',  'hsl(0,65%,50%)',   'hsl(270,65%,50%)',
  'hsl(180,65%,45%)', 'hsl(320,65%,50%)', 'hsl(90,65%,45%)',
  'hsl(240,55%,55%)',
];

/**
 * API base URL.  Empty string = same origin (the normal case when
 * Flask serves both the API and the frontend bundle).
 * Override via a global before this script loads:
 *   <script>window.__RDFSOLVE_API_BASE__ = 'http://localhost:5000';</script>
 */
const API_BASE: string = (window as any).__RDFSOLVE_API_BASE__ ?? '';

// =====================================================================
// FETCH DATASETS FROM API
// =====================================================================

interface SchemaListItem {
  id: string;
  name: string;
  endpoint?: string;
  pattern_count?: number;
}

async function loadDatasetsFromAPI(): Promise<
  Record<string, { name: string; url: string; color: string }>
> {
  const res = await fetch(`${API_BASE}/api/schemas/`);
  if (!res.ok) throw new Error(`GET /api/schemas/ → ${res.status}`);

  const schemas: SchemaListItem[] = await res.json();

  const datasets: Record<string, { name: string; url: string; color: string }> = {};
  for (let i = 0; i < schemas.length; i++) {
    const s = schemas[i];
    datasets[s.id] = {
      name: s.name,
      url: `${API_BASE}/api/schemas/${s.id}`,
      color: PALETTE[i % PALETTE.length],
    };
  }
  return datasets;
}

// =====================================================================
// INITIALISATION
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setStyle(DEFAULT_STYLE);

  const selector     = document.querySelector<DatasetSelector>('dataset-selector');
  const findNode     = document.querySelector<FindNode>('find-node');
  const sparqlEditor = document.querySelector<SparqlEditor>('sparql-editor');
  const pathList     = document.querySelector<PathList>('path-list');
  const iriResolver  = document.querySelector<IriResolver>('iri-resolver');
  const resultsPanel = document.querySelector<ResultsPanel>('results-panel');

  // ── Load datasets from API ──
  try {
    const DATASETS = await loadDatasetsFromAPI();
    if (selector) selector.setDatasets(DATASETS);
    if (iriResolver) iriResolver.loadEndpointsFromUrls(DATASETS);
  } catch (err) {
    console.error('Failed to load datasets from API:', err);
    const status = document.getElementById('status-text');
    if (status) status.textContent = '⚠ Error loading datasets from server';
  }

  // ── Wire component events (identical to demo-entry.ts) ──
  selector?.addEventListener('schema-loaded', () => {
    findNode?.refresh();
    sparqlEditor?.refresh();
    pathList?.refresh();
    iriResolver?.refresh();
    resultsPanel?.refreshEndpoints();
  });

  selector?.addEventListener('status', ((e: CustomEvent) => {
    const el = document.getElementById('status-text');
    if (el) el.textContent = e.detail;
  }) as EventListener);
});
