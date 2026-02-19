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
import './components/shapes-panel';

// Apply default style
import { setStyle, DEFAULT_STYLE } from './layout/styles';

import type { DatasetSelector } from './components/dataset-selector';
import type { FindNode } from './components/find-node';
import type { SparqlEditor } from './components/sparql-editor';
import type { PathList } from './components/path-list';
import type { IriResolver } from './components/iri-resolver';
import type { ResultsPanel } from './components/results-panel';
import type { ShapesPanel } from './components/shapes-panel';

// =====================================================================
// CONFIGURATION
// =====================================================================

// =====================================================================
// COLOUR PALETTE — perceptually spaced, supports many datasets
// =====================================================================

/**
 * Generate `n` well-spaced HSL colour strings using the golden-angle
 * method so that even 50+ datasets remain distinguishable.
 */
function generatePalette(n: number): string[] {
  const GOLDEN_ANGLE = 137.508; // degrees
  const colours: string[] = [];
  for (let i = 0; i < n; i++) {
    const hue = (i * GOLDEN_ANGLE) % 360;
    // Alternate lightness a little to improve contrast between neighbours
    const lightness = 42 + (i % 3) * 6;
    colours.push(`hsl(${hue.toFixed(0)}, 62%, ${lightness}%)`);
  }
  return colours;
}

/**
 * API base URL.  Empty string = same origin (the normal case when
 * Flask serves both the API and the frontend bundle).
 * Override via a global before this script loads:
 *   <script>window.__RDFSOLVE_API_BASE__ = 'http://localhost:8000';</script>
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
  const palette = generatePalette(schemas.length);

  const datasets: Record<string, { name: string; url: string; color: string }> = {};
  for (let i = 0; i < schemas.length; i++) {
    const s = schemas[i];
    datasets[s.id] = {
      name: s.name,
      url: `${API_BASE}/api/schemas/${s.id}`,
      color: palette[i],
    };
  }
  return datasets;
}

/**
 * Load instance-mapping linksets (strategy=instance_matcher) from the API.
 * These are the probe outputs — stored JSON-LD mapping documents that the
 * user can browse and compare in the Mapping datasets dropdown.
 * Colors are reused from `allDatasets` where IDs overlap, otherwise grey.
 */
async function loadMappingDatasetsFromAPI(
  allDatasets: Record<string, { name: string; url: string; color: string }>,
): Promise<Record<string, { name: string; url: string; color: string }>> {
  const res = await fetch(`${API_BASE}/api/schemas/?strategy=instance_matcher`);
  if (!res.ok) throw new Error(`GET /api/schemas/?strategy=instance_matcher → ${res.status}`);

  const schemas: SchemaListItem[] = await res.json();
  // DO NOT!!! Reuse colors from the already-generated allDatasets palette so swatches
  // are consistent between the two dropdowns.
  const datasets: Record<string, { name: string; url: string; color: string }> = {};
  for (const s of schemas) {
    datasets[s.id] = allDatasets[s.id] ?? {
      name: s.name,
      url: `${API_BASE}/api/schemas/${s.id}`,
      color: '#888',
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
  const shapesPanel  = document.querySelector<ShapesPanel>('shapes-panel');

  // ── Load datasets from API ──
  try {
    const DATASETS = await loadDatasetsFromAPI();
    if (selector) selector.setDatasets(DATASETS);
    if (iriResolver) iriResolver.loadEndpointsFromUrls(DATASETS);

    // Load instance-matcher linksets for the Mapping datasets dropdown.
    // These are the probe outputs (strategy=instance_matcher), not the source schemas.
    const MAPPING_DATASETS = await loadMappingDatasetsFromAPI(DATASETS);
    if (selector) selector.setMappingDatasets(MAPPING_DATASETS);
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
    shapesPanel?.refresh();
  });

  selector?.addEventListener('status', ((e: CustomEvent) => {
    const el = document.getElementById('status-text');
    if (el) el.textContent = e.detail;
  }) as EventListener);
});
