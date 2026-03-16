/**
 * Demo Entry Point
 *
 * This file imports components and configures datasets.
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

// =============================================================================
// DATASET CONFIGURATION - the only thing that varies per deployment
// =============================================================================

const DATASETS = {
  wikipathways: { name: 'WikiPathways', url: './wikipathways_schema.jsonld', color: 'hsl(210,65%,50%)' },
  pubchem_bioassay:         { name: 'PubChem Bioassay', url: './pubchem.bioassay_schema.jsonld',         color: 'hsl(140,65%,40%)' },
  pubchem_endpoint:   { name: 'PubChem Endpoint',   url: './pubchem.endpoint_schema.jsonld',   color: 'hsl(30,65%,50%)' },
  pubchem_gene:       { name: 'PubChem Gene',       url: './pubchem.gene_schema.jsonld',       color: 'hsl(60,65%,50%)' },
  aopwikirdf:        { name: 'AOP-Wiki RDF',        url: './aopwikirdf_schema.jsonld',        color: 'hsl(0,65%,50%)' },
  pubchem_measuregroup: { name: 'PubChem MeasureGroup', url: './pubchem.measuregroup_schema.jsonld', color: 'hsl(270,65%,50%)' },
};

// =============================================================================
// INITIALIZATION - wire dataset config into the selector
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  setStyle(DEFAULT_STYLE);

  // Feed datasets into the selector component
  const selector = document.querySelector<DatasetSelector>('dataset-selector');
  if (selector) selector.setDatasets(DATASETS);

  // When a schema is loaded, refresh dependent components
  const findNode = document.querySelector<FindNode>('find-node');
  const sparqlEditor = document.querySelector<SparqlEditor>('sparql-editor');
  const pathList = document.querySelector<PathList>('path-list');
  const iriResolver = document.querySelector<IriResolver>('iri-resolver');
  const resultsPanel = document.querySelector<ResultsPanel>('results-panel');
  const shapesPanel = document.querySelector<ShapesPanel>('shapes-panel');

  // Pre-fetch all JSON-LD files to discover SPARQL endpoints before any
  // diagram is rendered - the IRI Resolver endpoint list is populated
  // immediately so the user can start resolving IRIs right away.
  if (iriResolver) {
    iriResolver.loadEndpointsFromUrls(DATASETS);
  }

  selector?.addEventListener('schema-loaded', () => {
    findNode?.refresh();
    sparqlEditor?.refresh();
    pathList?.refresh();
    iriResolver?.refresh();
    resultsPanel?.refreshEndpoints();
    shapesPanel?.refresh();
  });

  // Status bar
  selector?.addEventListener('status', ((e: CustomEvent) => {
    const el = document.getElementById('status-text');
    if (el) el.textContent = e.detail;
  }) as EventListener);
});
